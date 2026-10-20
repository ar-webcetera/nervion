import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import type {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
  RtpCapabilities,
  RtpParameters,
  DtlsParameters,
  MediaKind,
} from 'mediasoup/node/lib/types';

export enum ProducerSource {
  Microphone = 'microphone',
  Screen = 'screen',
}

export interface ProducerAppData {
  source: ProducerSource;
  [key: string]: string;
}

export interface ClosedProducerInfo {
  producerId: string;
  kind: MediaKind;
}

export interface ExistingProducerInfo {
  producerId: string;
  userId: number;
  kind: MediaKind;
}

interface Participant {
  userId: number;
  displayName: string;
  photoUrl: string | null;
  socketId: string;
  sendTransport: WebRtcTransport | null;
  recvTransport: WebRtcTransport | null;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

interface Room {
  router: Router;
  participants: Map<number, Participant>;
}

const MEDIA_CODECS = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
    preferredPayloadType: 111,
    parameters: {
      minptime: 10,
      useinbandfec: 1,
      usedtx: 1,
    },
    rtcpFeedback: [],
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1000 },
    rtcpFeedback: [
      { type: 'nack', parameter: 'pli' },
      { type: 'ccm', parameter: 'fir' },
    ],
  },
  {
    kind: 'video',
    mimeType: 'video/VP9',
    clockRate: 90000,
    parameters: { 'profile-id': 2, 'x-google-start-bitrate': 1000 },
    rtcpFeedback: [
      { type: 'nack', parameter: 'pli' },
      { type: 'ccm', parameter: 'fir' },
    ],
  },
  {
    kind: 'video',
    mimeType: 'video/h264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '4d0032',
      'level-asymmetry-allowed': 1,
      'x-google-start-bitrate': 1000,
    },
    rtcpFeedback: [
      { type: 'nack', parameter: 'pli' },
      { type: 'ccm', parameter: 'fir' },
    ],
  },
] as mediasoup.types.RtpCodecCapability[];

export const ICE_SERVERS = (process.env.MEDIASOUP_ICE_SERVERS ?? 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
  .split(',')
  .map((url) => ({ urls: url.trim() }));

const getWebRtcTransportOptions = (): mediasoup.types.WebRtcTransportOptions => ({
  listenInfos: [
    {
      protocol: 'udp',
      ip: '0.0.0.0',
      announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
      portRange: { min: 40000, max: 49999 },
    },
    {
      protocol: 'tcp',
      ip: '0.0.0.0',
      announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
      portRange: { min: 40000, max: 49999 },
    },
  ],
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
  initialAvailableOutgoingBitrate: 600000,
});

@Injectable()
export class VoiceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceService.name);
  private worker: Worker | null = null;
  private readonly rooms = new Map<number, Room>();

  async onModuleInit() {
    this.worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
    });

    this.worker.on('died', (error) => {
      this.logger.error('mediasoup Worker died, exiting...', error);
      process.exit(1);
    });

    this.logger.log('mediasoup Worker started');
  }

  onModuleDestroy() {
    this.worker?.close();
  }

  async getOrCreateRoom(roomId: number): Promise<Room> {
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId)!;
    }

    const router = await this.worker!.createRouter({ mediaCodecs: MEDIA_CODECS });
    const room: Room = { router, participants: new Map() };
    this.rooms.set(roomId, room);
    this.logger.log(`Voice room created: ${roomId}`);
    return room;
  }

  getRoom(roomId: number): Room | undefined {
    return this.rooms.get(roomId);
  }

  getRoomParticipants(roomId: number): Participant[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return [...room.participants.values()];
  }

  getRouterRtpCapabilities(roomId: number): RtpCapabilities | null {
    const room = this.rooms.get(roomId);
    return room?.router.rtpCapabilities ?? null;
  }

  async createTransport(roomId: number): Promise<WebRtcTransport> {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    const transport = await room.router.createWebRtcTransport(getWebRtcTransportOptions());
    return transport;
  }

  async connectTransport(roomId: number, transportId: string, dtlsParameters: DtlsParameters): Promise<void> {
    const transport = this.findTransport(roomId, transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);
    await transport.connect({ dtlsParameters });
  }

  async produce(
    roomId: number,
    userId: number,
    transportId: string,
    kind: MediaKind,
    rtpParameters: RtpParameters,
    appData: ProducerAppData,
  ): Promise<Producer> {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);

    const participant = room.participants.get(userId);
    if (!participant) throw new Error(`Participant ${userId} not found`);

    const transport = this.findTransport(roomId, transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);

    const producer = await transport.produce({ kind, rtpParameters, appData });

    producer.on('transportclose', () => {
      producer.close();
    });

    participant.producers.set(producer.id, producer);
    return producer;
  }

  async consume(roomId: number, consumerId: number, producerId: string, rtpCapabilities: RtpCapabilities): Promise<Consumer> {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);

    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Cannot consume this producer');
    }

    const participant = room.participants.get(consumerId);
    if (!participant) throw new Error(`Participant ${consumerId} not found`);
    if (!participant.recvTransport) throw new Error(`Recv transport not found for participant ${consumerId}`);

    const consumer = await participant.recvTransport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });

    consumer.on('transportclose', () => consumer.close());
    consumer.on('producerclose', () => consumer.close());

    participant.consumers.set(producerId, consumer);
    return consumer;
  }

  async resumeConsumer(roomId: number, userId: number, consumerId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const participant = room.participants.get(userId);
    if (!participant) return;

    for (const consumer of participant.consumers.values()) {
      if (consumer.id === consumerId) {
        await consumer.resume();
        if (consumer.kind === 'video') {
          await consumer.requestKeyFrame().catch(() => {});
        }
        return;
      }
    }
  }

  async pauseProducer(roomId: number, userId: number): Promise<void> {
    const participant = this.rooms.get(roomId)?.participants.get(userId);
    if (!participant) return;
    for (const producer of participant.producers.values()) {
      if (producer.kind === 'audio') {
        await producer.pause();
        break;
      }
    }
  }

  async resumeProducer(roomId: number, userId: number): Promise<void> {
    const participant = this.rooms.get(roomId)?.participants.get(userId);
    if (!participant) return;
    for (const producer of participant.producers.values()) {
      if (producer.kind === 'audio') {
        await producer.resume();
        break;
      }
    }
  }

  closeVideoProducers(roomId: number, excludeUserId: number): Array<{ producerId: string; userId: number }> {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    const closed: Array<{ producerId: string; userId: number }> = [];
    for (const [uid, participant] of room.participants) {
      if (uid === excludeUserId) continue;
      for (const [producerId, producer] of participant.producers) {
        if (producer.kind === 'video') {
          producer.close();
          participant.producers.delete(producerId);
          closed.push({ producerId, userId: uid });
        }
      }
    }
    return closed;
  }

  closeProducer(roomId: number, userId: number, producerId: string): { kind: MediaKind } | null {
    const participant = this.rooms.get(roomId)?.participants.get(userId);
    if (!participant) return null;
    const producer = participant.producers.get(producerId);
    if (!producer) return null;
    const kind = producer.kind;
    producer.close();
    participant.producers.delete(producerId);
    return { kind };
  }

  addParticipant(roomId: number, userId: number, socketId: string, displayName: string, photoUrl: string | null): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.participants.set(userId, {
      userId,
      displayName,
      photoUrl,
      socketId,
      sendTransport: null,
      recvTransport: null,
      producers: new Map(),
      consumers: new Map(),
    });
  }

  registerSendTransport(roomId: number, userId: number, transport: WebRtcTransport): void {
    const participant = this.rooms.get(roomId)?.participants.get(userId);
    if (participant) participant.sendTransport = transport;
  }

  registerRecvTransport(roomId: number, userId: number, transport: WebRtcTransport): void {
    const participant = this.rooms.get(roomId)?.participants.get(userId);
    if (participant) participant.recvTransport = transport;
  }

  removeParticipant(roomId: number, userId: number): ClosedProducerInfo[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const participant = room.participants.get(userId);
    if (!participant) return [];

    const closedProducers: ClosedProducerInfo[] = [];
    for (const producer of participant.producers.values()) {
      closedProducers.push({ producerId: producer.id, kind: producer.kind });
      producer.close();
    }

    participant.sendTransport?.close();
    participant.recvTransport?.close();
    for (const consumer of participant.consumers.values()) consumer.close();

    room.participants.delete(userId);

    if (room.participants.size === 0) {
      room.router.close();
      this.rooms.delete(roomId);
      this.logger.log(`Voice room ${roomId} closed (empty)`);
    }

    return closedProducers;
  }

  findParticipantBySocket(socketId: string): { roomId: number; userId: number } | null {
    for (const [roomId, room] of this.rooms) {
      for (const [userId, participant] of room.participants) {
        if (participant.socketId === socketId) return { roomId, userId };
      }
    }
    return null;
  }

  getExistingProducers(roomId: number, excludeUserId: number): ExistingProducerInfo[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    const result: ExistingProducerInfo[] = [];
    for (const [userId, participant] of room.participants) {
      if (userId !== excludeUserId) {
        for (const producer of participant.producers.values()) {
          result.push({ producerId: producer.id, userId, kind: producer.kind });
        }
      }
    }
    return result;
  }

  private findTransport(roomId: number, transportId: string): WebRtcTransport | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    for (const participant of room.participants.values()) {
      if (participant.sendTransport?.id === transportId) return participant.sendTransport;
      if (participant.recvTransport?.id === transportId) return participant.recvTransport;
    }
    return null;
  }
}
