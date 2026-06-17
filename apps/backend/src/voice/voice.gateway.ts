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
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { ProjectMembers } from '../projects/entities/project.entity';
import { Users } from '../users/entities/users.entity';
import type { DtlsParameters, MediaKind, RtpCapabilities, RtpParameters } from 'mediasoup/node/lib/types';
import { ROLES } from '../common/enums/roles.enum';

interface JoinRoomBody {
  projectId: number;
}

interface CreateTransportBody {
  projectId: number;
  direction: 'send' | 'recv';
}

interface ConnectTransportBody {
  projectId: number;
  transportId: string;
  dtlsParameters: DtlsParameters;
}

interface ProduceBody {
  projectId: number;
  transportId: string;
  kind: MediaKind;
  rtpParameters: RtpParameters;
  appData?: ProducerAppData;
}

interface ConsumeBody {
  projectId: number;
  producerId: string;
  rtpCapabilities: RtpCapabilities;
}

interface ResumeConsumerBody {
  projectId: number;
  consumerId: string;
}

interface SetMuteBody {
  projectId: number;
  muted: boolean;
}

interface StopScreenShareBody {
  projectId: number;
  producerId: string;
}

interface LeaveRoomBody {
  projectId: number;
}

@WebSocketGateway({ namespace: '/voice', cors: true })
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(VoiceGateway.name);

  constructor(
    private readonly voiceService: VoiceService,
    private readonly wsGateway: WebsocketGateway,
    @InjectRepository(ProjectMembers)
    private readonly projectMemberRepository: Repository<ProjectMembers>,
    @InjectRepository(Users)
    private readonly userRepository: Repository<Users>,
  ) {}

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const found = this.voiceService.findParticipantBySocket(client.id);
    if (!found) return;

    const { projectId, userId } = found;
    const closedProducers = this.voiceService.removeParticipant(projectId, userId);

    for (const { producerId, kind } of closedProducers) {
      this.server.to(`project:${projectId}`).emit('producer-closed', { producerId, userId, kind });
    }

    await client.leave(`project:${projectId}`);
    this.emitRoomUpdate(projectId);
    this.logger.log(`User ${userId} disconnected from project ${projectId}`);
  }

  @SubscribeMessage('join-room')
  async onJoinRoom(@ConnectedSocket() client: Socket, @MessageBody() data: JoinRoomBody) {
    const userId = this.getUserId(client);
    if (!userId) return { error: 'Unauthorized' };

    const { projectId } = data;

    const isMember = await this.checkProjectMembership(userId, projectId);
    if (!isMember) return { error: 'Access denied' };

    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) return { error: 'User not found' };

    await this.voiceService.getOrCreateRoom(projectId);
    this.voiceService.addParticipant(
      projectId,
      userId,
      client.id,
      `${user.first_name} ${user.last_name}`,
      user.photo_url ?? null,
    );

    await client.join(`project:${projectId}`);

    const rtpCapabilities = this.voiceService.getRouterRtpCapabilities(projectId);
    const existingProducers = this.voiceService.getExistingProducers(projectId, userId);
    const participants = this.voiceService.getRoomParticipants(projectId).map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      photoUrl: p.photoUrl,
    }));

    this.server.to(`project:${projectId}`).emit('participant-joined', {
      userId,
      displayName: `${user.first_name} ${user.last_name}`,
      photoUrl: user.photo_url ?? null,
    });

    this.emitRoomUpdate(projectId);

    this.logger.log(`User ${userId} joined room for project ${projectId}`);

    return { rtpCapabilities, existingProducers, participants };
  }

  @SubscribeMessage('leave-room')
  async onLeaveRoom(@ConnectedSocket() client: Socket, @MessageBody() data: LeaveRoomBody) {
    const userId = this.getUserId(client);
    if (!userId) return;

    const { projectId } = data;
    const closedProducers = this.voiceService.removeParticipant(projectId, userId);

    for (const { producerId, kind } of closedProducers) {
      this.server.to(`project:${projectId}`).emit('producer-closed', { producerId, userId, kind });
    }

    await client.leave(`project:${projectId}`);
    this.emitRoomUpdate(projectId);
  }

  @SubscribeMessage('create-transport')
  async onCreateTransport(@ConnectedSocket() client: Socket, @MessageBody() data: CreateTransportBody) {
    const userId = this.getUserId(client);
    if (!userId) return { error: 'Unauthorized' };

    const { projectId, direction } = data;
    const transport = await this.voiceService.createTransport(projectId);

    if (direction === 'send') {
      this.voiceService.registerSendTransport(projectId, userId, transport);
    } else {
      this.voiceService.registerRecvTransport(projectId, userId, transport);
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

    const { projectId, transportId, dtlsParameters } = data;
    try {
      await this.voiceService.connectTransport(projectId, transportId, dtlsParameters);
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

    const { projectId, transportId, kind, rtpParameters, appData } = data;

    try {
      if (kind === 'video') {
        const closed = this.voiceService.closeVideoProducers(projectId, userId);
        for (const { producerId, userId: closedUserId } of closed) {
          this.server.to(`project:${projectId}`).emit('producer-closed', { producerId, userId: closedUserId, kind: 'video' });
        }
      }

      const producer = await this.voiceService.produce(
        projectId,
        userId,
        transportId,
        kind,
        rtpParameters,
        appData ?? { source: ProducerSource.Microphone },
      );

      this.server.to(`project:${projectId}`).except(client.id).emit('new-producer', {
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

    const { projectId, producerId, rtpCapabilities } = data;

    try {
      const consumer = await this.voiceService.consume(projectId, userId, producerId, rtpCapabilities);
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
      await this.voiceService.resumeConsumer(data.projectId, userId, data.consumerId);
    } catch (e) {
      this.logger.error(`onResumeConsumer error for user ${userId}: ${e instanceof Error ? e.message : e}`);
    }
    return { resumed: true };
  }

  @SubscribeMessage('set-mute')
  async onSetMute(@ConnectedSocket() client: Socket, @MessageBody() data: SetMuteBody) {
    const userId = this.getUserId(client);
    if (!userId) return;

    const { projectId, muted } = data;

    if (muted) {
      await this.voiceService.pauseProducer(projectId, userId);
    } else {
      await this.voiceService.resumeProducer(projectId, userId);
    }

    this.server.to(`project:${projectId}`).emit('participant-muted', { userId, muted });
  }

  @SubscribeMessage('stop-screen-share')
  onStopScreenShare(@ConnectedSocket() client: Socket, @MessageBody() data: StopScreenShareBody) {
    const userId = this.getUserId(client);
    if (!userId) return { error: 'Unauthorized' };

    const { projectId, producerId } = data;
    const closed = this.voiceService.closeProducer(projectId, userId, producerId);

    if (closed) {
      this.server.to(`project:${projectId}`).emit('producer-closed', { producerId, userId, kind: closed.kind });
    }

    return { stopped: true };
  }

  private emitRoomUpdate(projectId: number) {
    const participants = this.voiceService.getRoomParticipants(projectId).map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      photoUrl: p.photoUrl,
    }));
    this.wsGateway.sendVoiceRoomUpdate(projectId, participants);
  }

  private getUserId(client: Socket): number | null {
    const id = client.handshake.auth['user_id'] as string | undefined;
    if (!id) return null;
    return Number(id);
  }

  private async checkProjectMembership(userId: number, projectId: number): Promise<boolean> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (user?.role === ROLES.admin) return true;

    const member = await this.projectMemberRepository.findOne({
      where: { user: { id: userId }, project: { id: projectId } },
    });
    return !!member;
  }
}
