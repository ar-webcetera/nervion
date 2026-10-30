import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import { voiceIceServers, voicePortRange } from './voice-ice';
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

const getWebRtcTransportOptions = (): mediasoup.types.WebRtcTransportOptions => ({
  listenInfos: [
    {
      protocol: 'udp',
      ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
      announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
      portRange: voicePortRange(),
    },
    {
      protocol: 'tcp',
      ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
      announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
      portRange: voicePortRange(),
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
  // Keys include the tenant UUID, never the tenant-local numeric room ID alone.
  private readonly rooms = new Map<string, Room>();
  private readonly creating = new Map<string, Promise<Room>>();
  private readonly creationTokens = new Map<string, object>();

  async onModuleInit() {
    const ports = voicePortRange();
    voiceIceServers('configuration', 0);
    if (
      process.env.TENANCY_ENABLED === 'true' &&
      process.env.NODE_ENV === 'production' &&
      (!process.env.MEDIASOUP_ANNOUNCED_IP || ['127.0.0.1', '0.0.0.0', '::1'].includes(process.env.MEDIASOUP_ANNOUNCED_IP))
    )
      throw new Error('MEDIASOUP_ANNOUNCED_IP must be reachable by clients in production');
    this.worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: ports.min,
      rtcMaxPort: ports.max,
    });

    this.worker.on('died', (error) => {
      this.logger.error('mediasoup Worker died, exiting...', error);
      process.exit(1);
    });

    this.logger.log('mediasoup Worker started');
  }

  onModuleDestroy() {
    for (const roomId of this.rooms.keys()) this.closeRoom(roomId);
    this.worker?.close();
  }

  async getOrCreateRoom(roomId: string): Promise<Room> {
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId)!;
    }

    const pending = this.creating.get(roomId);
    if (pending) return pending;
    if (!this.worker) throw new Error('Голосовой сервер недоступен');
    const token = {};
    this.creationTokens.set(roomId, token);
    const create = this.worker.createRouter({ mediaCodecs: MEDIA_CODECS }).then((router) => {
      if (this.creationTokens.get(roomId) !== token) {
        router.close();
        throw new Error('Голосовая сессия завершена');
      }
      const room: Room = { router, participants: new Map() };
      this.rooms.set(roomId, room);
      return room;
    });
    this.creating.set(roomId, create);
    try {
      return await create;
    } finally {
      if (this.creating.get(roomId) === create) this.creating.delete(roomId);
      if (this.creationTokens.get(roomId) === token) this.creationTokens.delete(roomId);
    }
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getRoomParticipants(roomId: string): Participant[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return [...room.participants.values()];
  }

  getRouterRtpCapabilities(roomId: string): RtpCapabilities | null {
    const room = this.rooms.get(roomId);
    return room?.router.rtpCapabilities ?? null;
  }

  async createTransport(roomId: string): Promise<WebRtcTransport> {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    const transport = await room.router.createWebRtcTransport(getWebRtcTransportOptions());
    return transport;
  }

  async connectTransport(roomId: string, userId: number, transportId: string, dtlsParameters: DtlsParameters): Promise<void> {
    const transport = this.findTransport(roomId, userId, transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);
    await transport.connect({ dtlsParameters });
  }

  async produce(
    roomId: string,
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

    const transport = participant.sendTransport;
    if (!transport || transport.id !== transportId) throw new Error('Нет доступа к транспорту');
    if ([...participant.producers.values()].some((item) => item.kind === kind)) throw new Error('Поток этого типа уже запущен');

    const producer = await transport.produce({ kind, rtpParameters, appData });

    producer.on('transportclose', () => {
      producer.close();
      participant.producers.delete(producer.id);
    });

    participant.producers.set(producer.id, producer);
    return producer;
  }

  async consume(roomId: string, consumerId: number, producerId: string, rtpCapabilities: RtpCapabilities): Promise<Consumer> {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);

    const producerExists = [...room.participants.values()].some((participant) => participant.producers.has(producerId));
    if (!producerExists || !room.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Cannot consume this producer');
    }

    const participant = room.participants.get(consumerId);
    if (!participant) throw new Error(`Participant ${consumerId} not found`);
    if (!participant.recvTransport) throw new Error(`Recv transport not found for participant ${consumerId}`);
    const existing = participant.consumers.get(producerId);
    if (existing && !existing.closed) return existing;

    const consumer = await participant.recvTransport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });

    const closeConsumer = () => {
      consumer.close();
      participant.consumers.delete(producerId);
    };
    consumer.on('transportclose', closeConsumer);
    consumer.on('producerclose', closeConsumer);

    participant.consumers.set(producerId, consumer);
    return consumer;
  }

  async resumeConsumer(roomId: string, userId: number, consumerId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Комната недоступна');
    const participant = room.participants.get(userId);
    if (!participant) throw new Error('Участник недоступен');

    for (const consumer of participant.consumers.values()) {
      if (consumer.id === consumerId) {
        await consumer.resume();
        if (consumer.kind === 'video') {
          await consumer.requestKeyFrame().catch(() => {});
        }
        return;
      }
    }
    throw new Error('Поток недоступен');
  }

  async pauseProducer(roomId: string, userId: number): Promise<void> {
    const participant = this.rooms.get(roomId)?.participants.get(userId);
    if (!participant) return;
    for (const producer of participant.producers.values()) {
      if (producer.kind === 'audio') {
        await producer.pause();
        break;
      }
    }
  }

  async resumeProducer(roomId: string, userId: number): Promise<void> {
    const participant = this.rooms.get(roomId)?.participants.get(userId);
    if (!participant) return;
    for (const producer of participant.producers.values()) {
      if (producer.kind === 'audio') {
        await producer.resume();
        break;
      }
    }
  }

  closeVideoProducers(roomId: string, excludeUserId: number): Array<{ producerId: string; userId: number }> {
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

  closeProducer(roomId: string, userId: number, producerId: string): { kind: MediaKind } | null {
    const participant = this.rooms.get(roomId)?.participants.get(userId);
    if (!participant) return null;
    const producer = participant.producers.get(producerId);
    if (!producer) return null;
    const kind = producer.kind;
    producer.close();
    participant.producers.delete(producerId);
    return { kind };
  }

  addParticipant(roomId: string, userId: number, socketId: string, displayName: string, photoUrl: string | null): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Комната недоступна');
    const existing = room.participants.get(userId);
    if (existing?.socketId === socketId) return;
    if (existing) throw new Error('Вы уже подключены к комнате в другой вкладке');
    if (room.participants.size >= 50) throw new Error('В комнате уже 50 участников');
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

  registerSendTransport(roomId: string, userId: number, transport: WebRtcTransport): void {
    const participant = this.rooms.get(roomId)?.participants.get(userId);
    if (!participant || participant.sendTransport) {
      transport.close();
      throw new Error('Транспорт уже создан');
    }
    participant.sendTransport = transport;
  }

  registerRecvTransport(roomId: string, userId: number, transport: WebRtcTransport): void {
    const participant = this.rooms.get(roomId)?.participants.get(userId);
    if (!participant || participant.recvTransport) {
      transport.close();
      throw new Error('Транспорт уже создан');
    }
    participant.recvTransport = transport;
  }

  removeParticipant(roomId: string, userId: number): ClosedProducerInfo[] {
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

  findParticipantBySocket(socketId: string): { roomId: string; userId: number } | null {
    for (const [roomId, room] of this.rooms) {
      for (const [userId, participant] of room.participants) {
        if (participant.socketId === socketId) return { roomId, userId };
      }
    }
    return null;
  }

  getExistingProducers(roomId: string, excludeUserId: number): ExistingProducerInfo[] {
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

  closeRoom(roomId: string): void {
    this.creationTokens.delete(roomId);
    this.creating.delete(roomId);
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const userId of [...room.participants.keys()]) this.removeParticipant(roomId, userId);
    if (!room.router.closed) room.router.close();
    this.rooms.delete(roomId);
  }

  assertParticipant(roomId: string, userId: number, socketId: string): void {
    if (this.rooms.get(roomId)?.participants.get(userId)?.socketId !== socketId)
      throw new Error('Нет доступа к голосовой сессии');
  }

  private findTransport(roomId: string, userId: number, transportId: string): WebRtcTransport | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const participant = room.participants.get(userId);
    if (participant?.sendTransport?.id === transportId) return participant.sendTransport;
    if (participant?.recvTransport?.id === transportId) return participant.recvTransport;
    return null;
  }
}
