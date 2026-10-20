import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VoiceService, ICE_SERVERS, ProducerAppData, ProducerSource } from './voice.service';
import { VoiceRoomsService } from './voice-rooms.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { Users } from '../users/entities/users.entity';
import type { DtlsParameters, MediaKind, RtpCapabilities, RtpParameters } from 'mediasoup/node/lib/types';
import { JwtAuthService } from '../auth/jwt.service';

interface JoinRoomBody {
  roomId: number;
}

interface CreateTransportBody {
  roomId: number;
  direction: 'send' | 'recv';
}

interface ConnectTransportBody {
  roomId: number;
  transportId: string;
  dtlsParameters: DtlsParameters;
}

interface ProduceBody {
  roomId: number;
  transportId: string;
  kind: MediaKind;
  rtpParameters: RtpParameters;
  appData?: ProducerAppData;
}

interface ConsumeBody {
  roomId: number;
  producerId: string;
  rtpCapabilities: RtpCapabilities;
}

interface ResumeConsumerBody {
  roomId: number;
  consumerId: string;
}

interface SetMuteBody {
  roomId: number;
  muted: boolean;
}

interface StopScreenShareBody {
  roomId: number;
  producerId: string;
}

interface LeaveRoomBody {
  roomId: number;
}

@WebSocketGateway({ namespace: '/voice', cors: true })
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(VoiceGateway.name);

  constructor(
    private readonly voiceService: VoiceService,
    private readonly voiceRoomsService: VoiceRoomsService,
    private readonly wsGateway: WebsocketGateway,
    private readonly jwtAuthService: JwtAuthService,
    @InjectRepository(Users)
    private readonly userRepository: Repository<Users>,
  ) {}

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const found = this.voiceService.findParticipantBySocket(client.id);
    if (!found) return;

    const { roomId, userId } = found;
    const closedProducers = this.voiceService.removeParticipant(roomId, userId);

    for (const { producerId, kind } of closedProducers) {
      this.server.to(`voice-room:${roomId}`).emit('producer-closed', { producerId, userId, kind });
    }

    await client.leave(`voice-room:${roomId}`);
    this.emitRoomUpdate(roomId);
    this.logger.log(`User ${userId} disconnected from room ${roomId}`);
  }

  @SubscribeMessage('join-room')
  async onJoinRoom(@ConnectedSocket() client: Socket, @MessageBody() data: JoinRoomBody) {
    const userId = this.getUserId(client);
    if (!userId) return { error: 'Unauthorized' };

    const { roomId } = data;

    const isMember = await this.voiceRoomsService.canJoin(roomId, userId);
    if (!isMember) return { error: 'Access denied' };

    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) return { error: 'User not found' };

    await this.voiceService.getOrCreateRoom(roomId);
    this.voiceService.addParticipant(roomId, userId, client.id, `${user.first_name} ${user.last_name}`, user.photo_url ?? null);

    await client.join(`voice-room:${roomId}`);

    const rtpCapabilities = this.voiceService.getRouterRtpCapabilities(roomId);
    const existingProducers = this.voiceService.getExistingProducers(roomId, userId);
    const participants = this.voiceService.getRoomParticipants(roomId).map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      photoUrl: p.photoUrl,
    }));

    this.server.to(`voice-room:${roomId}`).emit('participant-joined', {
      userId,
      displayName: `${user.first_name} ${user.last_name}`,
      photoUrl: user.photo_url ?? null,
    });

    this.emitRoomUpdate(roomId);

    this.logger.log(`User ${userId} joined voice room ${roomId}`);

    return { rtpCapabilities, existingProducers, participants };
  }

  @SubscribeMessage('leave-room')
  async onLeaveRoom(@ConnectedSocket() client: Socket, @MessageBody() data: LeaveRoomBody) {
    const userId = this.getUserId(client);
    if (!userId) return;

    const { roomId } = data;
    const closedProducers = this.voiceService.removeParticipant(roomId, userId);

    for (const { producerId, kind } of closedProducers) {
      this.server.to(`voice-room:${roomId}`).emit('producer-closed', { producerId, userId, kind });
    }

    await client.leave(`voice-room:${roomId}`);
    this.emitRoomUpdate(roomId);
  }

  @SubscribeMessage('create-transport')
  async onCreateTransport(@ConnectedSocket() client: Socket, @MessageBody() data: CreateTransportBody) {
    const userId = this.getUserId(client);
    if (!userId) return { error: 'Unauthorized' };

    const { roomId, direction } = data;
    const transport = await this.voiceService.createTransport(roomId);

    if (direction === 'send') {
      this.voiceService.registerSendTransport(roomId, userId, transport);
    } else {
      this.voiceService.registerRecvTransport(roomId, userId, transport);
    }

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      iceServers: ICE_SERVERS,
    };
  }

  @SubscribeMessage('connect-transport')
  async onConnectTransport(@ConnectedSocket() client: Socket, @MessageBody() data: ConnectTransportBody) {
    const userId = this.getUserId(client);
    if (!userId) return { error: 'Unauthorized' };

    const { roomId, transportId, dtlsParameters } = data;
    try {
      await this.voiceService.connectTransport(roomId, transportId, dtlsParameters);
      return { connected: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Connect transport failed';
      this.logger.error(`onConnectTransport error for user ${userId}: ${message}`);
      return { error: message };
    }
  }

  @SubscribeMessage('produce')
  async onProduce(@ConnectedSocket() client: Socket, @MessageBody() data: ProduceBody) {
    const userId = this.getUserId(client);
    if (!userId) return { error: 'Unauthorized' };

    const { roomId, transportId, kind, rtpParameters, appData } = data;

    try {
      if (kind === 'video') {
        const closed = this.voiceService.closeVideoProducers(roomId, userId);
        for (const { producerId, userId: closedUserId } of closed) {
          this.server.to(`voice-room:${roomId}`).emit('producer-closed', { producerId, userId: closedUserId, kind: 'video' });
        }
      }

      const producer = await this.voiceService.produce(
        roomId,
        userId,
        transportId,
        kind,
        rtpParameters,
        appData ?? { source: ProducerSource.Microphone },
      );

      this.server.to(`voice-room:${roomId}`).except(client.id).emit('new-producer', {
        producerId: producer.id,
        userId,
        kind: producer.kind,
      });

      return { producerId: producer.id };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Produce failed';
      this.logger.error(`onProduce error for user ${userId}: ${message}`);
      return { error: message };
    }
  }

  @SubscribeMessage('consume')
  async onConsume(@ConnectedSocket() client: Socket, @MessageBody() data: ConsumeBody) {
    const userId = this.getUserId(client);
    if (!userId) return { error: 'Unauthorized' };

    const { roomId, producerId, rtpCapabilities } = data;

    try {
      const consumer = await this.voiceService.consume(roomId, userId, producerId, rtpCapabilities);
      return {
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Consume failed';
      this.logger.error(`onConsume error for user ${userId}: ${message}`);
      return { error: message };
    }
  }

  @SubscribeMessage('resume-consumer')
  async onResumeConsumer(@ConnectedSocket() client: Socket, @MessageBody() data: ResumeConsumerBody) {
    const userId = this.getUserId(client);
    if (!userId) return { error: 'Unauthorized' };

    try {
      await this.voiceService.resumeConsumer(data.roomId, userId, data.consumerId);
    } catch (e) {
      this.logger.error(`onResumeConsumer error for user ${userId}: ${e instanceof Error ? e.message : e}`);
    }
    return { resumed: true };
  }

  @SubscribeMessage('set-mute')
  async onSetMute(@ConnectedSocket() client: Socket, @MessageBody() data: SetMuteBody) {
    const userId = this.getUserId(client);
    if (!userId) return;

    const { roomId, muted } = data;

    if (muted) {
      await this.voiceService.pauseProducer(roomId, userId);
    } else {
      await this.voiceService.resumeProducer(roomId, userId);
    }

    this.server.to(`voice-room:${roomId}`).emit('participant-muted', { userId, muted });
  }

  @SubscribeMessage('stop-screen-share')
  onStopScreenShare(@ConnectedSocket() client: Socket, @MessageBody() data: StopScreenShareBody) {
    const userId = this.getUserId(client);
    if (!userId) return { error: 'Unauthorized' };

    const { roomId, producerId } = data;
    const closed = this.voiceService.closeProducer(roomId, userId, producerId);

    if (closed) {
      this.server.to(`voice-room:${roomId}`).emit('producer-closed', { producerId, userId, kind: closed.kind });
    }

    return { stopped: true };
  }

  private emitRoomUpdate(roomId: number) {
    const participants = this.voiceService.getRoomParticipants(roomId).map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      photoUrl: p.photoUrl,
    }));
    void this.wsGateway.sendVoiceRoomUpdate(roomId, participants);
  }

  private getUserId(client: Socket): number | null {
    const rawToken = client.handshake.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('authToken='))
      ?.slice(10);
    if (!rawToken) return null;
    try {
      const payload = this.jwtAuthService.verifyToken(decodeURIComponent(rawToken));
      return Number(payload.id ?? payload.userId) || null;
    } catch {
      return null;
    }
  }
}
