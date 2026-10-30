import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ForbiddenException, HttpException, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProducerSource, VoiceService } from './voice.service';
import { voiceIceServers } from './voice-ice';
import { VoiceRoomsService } from './voice-rooms.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { TenantSocketService } from '../websocket/tenant-socket.service';
import { TenantContextService, tenantStorage } from '../tenancy/tenant-context.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PlatformService } from '../platform/platform.service';
import { Users } from '../users/entities/users.entity';
import { ROLES } from '../common/enums/roles.enum';
import { VoiceClusterService } from './voice-cluster.service';
import { VoiceCommand } from './voice.enums';
import { VoiceBody, VoicePeer, VoiceReply, VoiceRequest, voiceRoomKey, voiceSocketRoom } from './voice.protocol';

@WebSocketGateway({ namespace: '/voice', cors: true, maxHttpBufferSize: 65536 })
export class VoiceGateway implements OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(VoiceGateway.name);
  private readonly peers = new Map<string, Map<number, VoicePeer>>();
  private sweep?: NodeJS.Timeout;
  private sweeping = false;
  private readonly authorizedAt = new Map<string, number>();
  private lastSweep = 0;

  constructor(
    private readonly voiceService: VoiceService,
    private readonly voiceRoomsService: VoiceRoomsService,
    private readonly wsGateway: WebsocketGateway,
    private readonly sockets: TenantSocketService,
    private readonly context: TenantContextService,
    private readonly database: TenantDatabaseService,
    private readonly platform: PlatformService,
    private readonly cluster: VoiceClusterService,
    @InjectRepository(Users) private readonly userRepository: Repository<Users>,
  ) {
    this.cluster.bind(
      (request) => this.execute(request),
      (key) => this.closeOwnedRoom(key),
    );
  }

  afterInit(server: Server): void {
    server.use((client, next) => {
      this.sockets.connect(client).then(
        () => next(),
        () => next(new Error('Нет доступа к голосовой связи')),
      );
    });
  }

  onModuleInit(): void {
    // No request EntityManager is captured by long-lived SFU/timer callbacks.
    this.sweep = tenantStorage.exit(() =>
      setInterval(() => {
        // Synchronous safety deadline also applies when database checks hang.
        for (const [key, peers] of this.peers) {
          if ([...peers.values()].some((peer) => Date.now() - (this.authorizedAt.get(peer.socketId) ?? 0) >= 20000)) {
            this.closeOwnedRoom(key);
            void this.cluster.release(key).catch(() => undefined);
          }
        }
        if (Date.now() - this.lastSweep >= 5000) {
          this.lastSweep = Date.now();
          void this.revalidate().catch(() => this.logger.warn('Voice session revalidation failed'));
        }
      }, 1000),
    );
    this.sweep.unref();
  }

  onModuleDestroy(): void {
    if (this.sweep) clearInterval(this.sweep);
    for (const key of [...this.peers.keys()]) this.closeOwnedRoom(key);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const identity = this.sockets.identity(client);
    const roomId = client.data.voiceRoomId as number | undefined;
    if (!identity || !roomId) return;
    try {
      await this.cluster.execute({ command: VoiceCommand.Leave, body: { roomId }, peer: this.peer(client) });
    } catch {
      /* The owner watchdog also removes missing sockets. */
    }
  }

  @SubscribeMessage(VoiceCommand.Join)
  async onJoinRoom(@ConnectedSocket() client: Socket, @MessageBody() body: VoiceBody) {
    if (client.data.voiceJoining || client.data.voiceRoomId) return { error: 'Вы уже подключены к голосовой комнате' };
    client.data.voiceJoining = true;
    try {
      const result = await this.dispatch(client, VoiceCommand.Join, body);
      if (!result.error) client.data.voiceRoomId = body.roomId;
      return result;
    } finally {
      client.data.voiceJoining = false;
    }
  }

  @SubscribeMessage(VoiceCommand.Leave)
  async onLeaveRoom(@ConnectedSocket() client: Socket, @MessageBody() body: VoiceBody) {
    const result = await this.dispatch(client, VoiceCommand.Leave, body);
    if (!result.error) delete client.data.voiceRoomId;
    return result;
  }

  @SubscribeMessage(VoiceCommand.CreateTransport)
  onCreateTransport(@ConnectedSocket() client: Socket, @MessageBody() body: VoiceBody) {
    return this.dispatch(client, VoiceCommand.CreateTransport, body);
  }
  @SubscribeMessage(VoiceCommand.ConnectTransport)
  onConnectTransport(@ConnectedSocket() client: Socket, @MessageBody() body: VoiceBody) {
    return this.dispatch(client, VoiceCommand.ConnectTransport, body);
  }
  @SubscribeMessage(VoiceCommand.Produce)
  onProduce(@ConnectedSocket() client: Socket, @MessageBody() body: VoiceBody) {
    return this.dispatch(client, VoiceCommand.Produce, body);
  }
  @SubscribeMessage(VoiceCommand.Consume)
  onConsume(@ConnectedSocket() client: Socket, @MessageBody() body: VoiceBody) {
    return this.dispatch(client, VoiceCommand.Consume, body);
  }
  @SubscribeMessage(VoiceCommand.ResumeConsumer)
  onResumeConsumer(@ConnectedSocket() client: Socket, @MessageBody() body: VoiceBody) {
    return this.dispatch(client, VoiceCommand.ResumeConsumer, body);
  }
  @SubscribeMessage(VoiceCommand.Mute)
  onSetMute(@ConnectedSocket() client: Socket, @MessageBody() body: VoiceBody) {
    return this.dispatch(client, VoiceCommand.Mute, body);
  }
  @SubscribeMessage(VoiceCommand.StopScreen)
  onStopScreenShare(@ConnectedSocket() client: Socket, @MessageBody() body: VoiceBody) {
    return this.dispatch(client, VoiceCommand.StopScreen, body);
  }

  private peer(client: Socket): VoicePeer {
    const identity = this.sockets.identity(client);
    if (!identity) throw new ForbiddenException('Нет доступа к голосовой связи');
    // Never accept identity, owner or target socket from the client payload.
    return { ...identity, socketId: client.id, headers: { ...client.handshake.headers } };
  }

  private async dispatch(client: Socket, command: VoiceCommand, body: VoiceBody): Promise<VoiceReply> {
    try {
      const now = Date.now();
      const budget = client.data.voiceBudget as { tokens: number; at: number } | undefined;
      const tokens = budget ? Math.min(200, budget.tokens + (now - budget.at) / 50) : 200;
      client.data.voiceBudget = { tokens: Math.max(0, tokens - 1), at: now };
      if (tokens < 1) throw new Error('Слишком много голосовых команд. Подождите немного');
      if (!body || !Number.isSafeInteger(body.roomId) || body.roomId < 1) throw new Error('Некорректная комната');
      if (Buffer.byteLength(JSON.stringify(body)) > 65536) throw new Error('Слишком большая голосовая команда');
      const previous = this.sockets.identity(client);
      const current = await this.sockets.authenticateConnected(client);
      if (!previous || previous.tenantId !== current.tenantId || previous.userId !== current.userId)
        throw new ForbiddenException();
      if (command !== VoiceCommand.Join && client.data.voiceRoomId !== body.roomId) throw new ForbiddenException();
      return await this.cluster.execute({ peer: this.peer(client), command, body });
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Голосовая связь недоступна' };
    }
  }

  private async authorize<T>(peer: VoicePeer, roomId: number, work: () => Promise<T>): Promise<T> {
    // Owner repeats validation. A Redis-routed request is not an authorization grant.
    const [live] = await this.server.in(peer.socketId).fetchSockets();
    if (!live) throw new ForbiddenException('Голосовая сессия завершена');
    const identity = await this.sockets.authenticateConnected(live);
    if (
      identity.tenantId !== peer.tenantId ||
      identity.userId !== peer.userId ||
      ![String(ROLES.admin), String(ROLES.employee)].includes(identity.role)
    )
      throw new ForbiddenException('Нет доступа к голосовой связи');
    if (live.handshake.headers.cookie !== peer.headers.cookie) throw new ForbiddenException('Голосовая сессия завершена');
    const run = async () => {
      if (!(await this.voiceRoomsService.canJoin(roomId, identity.userId))) throw new ForbiddenException('Нет доступа к комнате');
      this.authorizedAt.set(peer.socketId, Date.now());
      return work();
    };
    if (!this.context.isEnabled()) return run();
    const tenant = await this.platform.getTenant(identity.tenantId);
    if (tenant.featureFlags.voice !== true) throw new ForbiddenException('Голосовая связь отключена');
    if (tenant.readOnly) throw new ForbiddenException('Пространство доступно только для чтения');
    return this.database.run(tenant, run, { readOnly: true, actorId: identity.userId });
  }

  private async execute({ peer, command, body }: VoiceRequest): Promise<VoiceReply> {
    const key = voiceRoomKey(peer.tenantId, body.roomId);
    // Leaving must still clean resources after session expiration or suspension.
    if (command === VoiceCommand.Leave) {
      if (this.peers.get(key)?.get(peer.userId)?.socketId === peer.socketId) await this.removePeer(key, peer, body.roomId);
      if (!this.peers.get(key)?.size) await this.cluster.release(key).catch(() => undefined);
      return { left: true };
    }
    try {
      return await this.authorize(peer, body.roomId, async () => {
        await this.cluster.assertOwnership(key);
        if (command === VoiceCommand.Join) {
          if (!(await this.server.in(peer.socketId).fetchSockets()).length) throw new Error('Соединение закрыто');
          const user = await this.userRepository.findOneByOrFail({ id: peer.userId });
          await this.voiceService.getOrCreateRoom(key);
          this.voiceService.addParticipant(
            key,
            peer.userId,
            peer.socketId,
            `${user.first_name} ${user.last_name}`,
            user.photo_url ?? null,
          );
          if (!this.peers.has(key)) this.peers.set(key, new Map());
          this.peers.get(key)!.set(peer.userId, peer);
          this.server.in(peer.socketId).socketsJoin(voiceSocketRoom(key));
          await this.emitParticipants(key, body.roomId);
          this.server.to(voiceSocketRoom(key)).emit('participant-joined', {
            userId: peer.userId,
            displayName: `${user.first_name} ${user.last_name}`,
            photoUrl: user.photo_url ?? null,
          });
          return {
            rtpCapabilities: this.voiceService.getRouterRtpCapabilities(key)!,
            existingProducers: this.voiceService.getExistingProducers(key, peer.userId),
            participants: this.summaries(key),
          };
        }
        this.voiceService.assertParticipant(key, peer.userId, peer.socketId);
        switch (command) {
          case VoiceCommand.CreateTransport: {
            if (!['send', 'recv'].includes(body.direction ?? '')) throw new Error('Некорректное направление транспорта');
            const transport = await this.voiceService.createTransport(key);
            if (body.direction === 'send') this.voiceService.registerSendTransport(key, peer.userId, transport);
            else this.voiceService.registerRecvTransport(key, peer.userId, transport);
            return {
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters,
              iceServers: voiceIceServers(peer.tenantId, peer.userId),
            };
          }
          case VoiceCommand.ConnectTransport:
            if (!body.transportId || !body.dtlsParameters) throw new Error('Некорректный транспорт');
            await this.voiceService.connectTransport(key, peer.userId, body.transportId, body.dtlsParameters);
            return { connected: true };
          case VoiceCommand.Produce: {
            if (!body.transportId || !body.rtpParameters || !['audio', 'video'].includes(body.kind ?? ''))
              throw new Error('Некорректный поток');
            const kind = body.kind!;
            const source = kind === 'audio' ? ProducerSource.Microphone : ProducerSource.Screen;
            if (body.appData && body.appData.source !== source) throw new Error('Некорректный источник потока');
            const producer = await this.voiceService.produce(key, peer.userId, body.transportId, kind, body.rtpParameters, {
              source,
            });
            this.server
              .to(voiceSocketRoom(key))
              .except(peer.socketId)
              .emit('new-producer', { producerId: producer.id, userId: peer.userId, kind });
            return { producerId: producer.id };
          }
          case VoiceCommand.Consume: {
            if (!body.producerId || !body.rtpCapabilities) throw new Error('Некорректный поток');
            const consumer = await this.voiceService.consume(key, peer.userId, body.producerId, body.rtpCapabilities);
            return { id: consumer.id, producerId: body.producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters };
          }
          case VoiceCommand.ResumeConsumer:
            if (!body.consumerId) throw new Error('Некорректный поток');
            await this.voiceService.resumeConsumer(key, peer.userId, body.consumerId);
            return { resumed: true };
          case VoiceCommand.Mute:
            if (typeof body.muted !== 'boolean') throw new Error('Некорректное состояние микрофона');
            if (body.muted) await this.voiceService.pauseProducer(key, peer.userId);
            else await this.voiceService.resumeProducer(key, peer.userId);
            this.server.to(voiceSocketRoom(key)).emit('participant-muted', { userId: peer.userId, muted: body.muted });
            return { muted: body.muted };
          case VoiceCommand.StopScreen: {
            if (!body.producerId) throw new Error('Некорректный поток');
            const ownProducer = this.voiceService
              .getRoomParticipants(key)
              .find((item) => item.userId === peer.userId)
              ?.producers.get(body.producerId);
            if (ownProducer?.kind !== 'video') throw new Error('Нет доступа к демонстрации');
            this.voiceService.closeProducer(key, peer.userId, body.producerId);
            this.server
              .to(voiceSocketRoom(key))
              .emit('producer-closed', { producerId: body.producerId, userId: peer.userId, kind: 'video' });
            return { stopped: true };
          }
          default:
            throw new Error('Неизвестное действие');
        }
      });
    } catch (error) {
      if (
        error instanceof HttpException &&
        [401, 403, 404].includes(error.getStatus()) &&
        this.peers.get(key)?.get(peer.userId)?.socketId === peer.socketId
      ) {
        await this.removePeer(key, peer, body.roomId);
        this.server.to(peer.socketId).emit('voice-session-ended', { reason: 'Доступ к голосовой комнате закрыт' });
        this.server.in(peer.socketId).disconnectSockets(true);
      }
      if (this.peers.get(key)?.get(peer.userId)?.socketId !== peer.socketId) this.authorizedAt.delete(peer.socketId);
      if (!this.voiceService.getRoomParticipants(key).length) {
        this.voiceService.closeRoom(key);
        this.peers.delete(key);
        await this.cluster.release(key).catch(() => undefined);
      }
      return { error: error instanceof Error ? error.message : 'Голосовая связь недоступна' };
    }
  }

  private summaries(key: string) {
    return this.voiceService
      .getRoomParticipants(key)
      .map(({ userId, displayName, photoUrl }) => ({ userId, displayName, photoUrl }));
  }

  private async emitParticipants(key: string, roomId: number): Promise<void> {
    const participants = this.summaries(key);
    await this.cluster.publishPresence(key, participants);
    await this.wsGateway.sendVoiceRoomUpdate(roomId, participants);
  }

  private async removePeer(key: string, peer: VoicePeer, roomId: number): Promise<void> {
    if (this.peers.get(key)?.get(peer.userId)?.socketId !== peer.socketId) return;
    for (const producer of this.voiceService.removeParticipant(key, peer.userId))
      this.server.to(voiceSocketRoom(key)).emit('producer-closed', { ...producer, userId: peer.userId });
    this.peers.get(key)?.delete(peer.userId);
    this.authorizedAt.delete(peer.socketId);
    this.server.in(peer.socketId).socketsLeave(voiceSocketRoom(key));
    this.server.to(voiceSocketRoom(key)).emit('participant-left', { userId: peer.userId });
    const notify = () => this.emitParticipants(key, roomId);
    try {
      if (this.context.isEnabled())
        await this.database.run(await this.platform.getTenant(peer.tenantId), notify, { readOnly: true });
      else await notify();
    } catch {
      /* Tenant may already be blocked. Resource cleanup still completes. */
    }
    if (!this.peers.get(key)?.size) {
      this.peers.delete(key);
      await this.cluster.release(key).catch(() => undefined);
    }
  }

  private closeOwnedRoom(key: string): void {
    const peers = this.peers.get(key);
    this.voiceService.closeRoom(key);
    this.peers.delete(key);
    if (!this.server) return;
    for (const peer of peers?.values() ?? []) {
      this.authorizedAt.delete(peer.socketId);
      this.server.to(peer.socketId).emit('voice-session-ended', { reason: 'Голосовой сервер недоступен. Подключитесь повторно' });
      this.server.in(peer.socketId).disconnectSockets(true);
    }
  }

  private async revalidate(): Promise<void> {
    if (this.sweeping || !this.server) return;
    this.sweeping = true;
    try {
      for (const key of [...this.peers.keys()]) {
        try {
          await this.cluster.inspect(key, async () => {
            const roomId = Number(key.slice(key.lastIndexOf(':') + 1));
            for (const peer of [...(this.peers.get(key)?.values() ?? [])]) {
              try {
                await this.authorize(peer, roomId, () => Promise.resolve(undefined));
              } catch {
                await this.removePeer(key, peer, roomId);
                this.server.to(peer.socketId).emit('voice-session-ended', { reason: 'Доступ к голосовой комнате закрыт' });
                this.server.in(peer.socketId).disconnectSockets(true);
              }
            }
            if (this.peers.has(key)) await this.cluster.publishPresence(key, this.summaries(key));
          });
        } catch {
          this.closeOwnedRoom(key);
        }
      }
    } finally {
      this.sweeping = false;
    }
  }
}
