import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { tenantStorage } from '../tenancy/tenant-context.service';
import { VoiceReply, VoiceRequest, VoiceParticipantSummary, voiceRoomKey } from './voice.protocol';

interface RpcRequest {
  id: string;
  source: string;
  owner: string;
  deadline: number;
  request: VoiceRequest;
}
interface RpcReply { id: string; owner: string; result: VoiceReply }
interface Pending {
  owner: string;
  resolve: (reply: VoiceReply) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const LEASE_MS = 30000;
const FENCE_MS = 20000;
const TIMEOUT_MS = 10000;
const PREFIX = 'nervion:voice:v1:';
const OWNER_RENEW = "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end";
const OWNER_RELEASE = "if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('DEL',KEYS[1]); redis.call('DEL',KEYS[2]); return 1 else return 0 end";
const PRESENCE_WRITE = "if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('SET',KEYS[2],ARGV[2],'PX',ARGV[3]); return 1 else return 0 end";

/** Redis routes signaling to one leased SFU owner, not media packets between SFUs. */
@Injectable()
export class VoiceClusterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceClusterService.name);
  readonly nodeId = randomUUID();
  private redis?: ReturnType<typeof createClient>;
  private subscriber?: ReturnType<typeof createClient>;
  private heartbeat?: NodeJS.Timeout;
  private renewing = false;
  private readonly leases = new Map<string, number>();
  private readonly pending = new Map<string, Pending>();
  private readonly queues = new Map<string, Promise<VoiceReply>>();
  private readonly queued = new Map<string, number>();
  private readonly completed = new Map<string, { deadline: number; reply: Promise<VoiceReply> }>();
  private handler?: (request: VoiceRequest) => Promise<VoiceReply>;
  private lost?: (key: string) => void;

  bind(handler: (request: VoiceRequest) => Promise<VoiceReply>, lost: (key: string) => void): void {
    this.handler = handler;
    this.lost = lost;
  }

  async onModuleInit(): Promise<void> {
    if (process.env.TENANCY_ENABLED !== 'true') return;
    if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required for tenant voice');
    this.redis = createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true });
    this.subscriber = this.redis.duplicate();
    const failed = () => {
      this.logger.warn('Voice Redis connection lost, closing owned rooms');
      for (const key of [...this.leases.keys()]) this.lose(key);
    };
    this.redis.on('error', failed);
    this.redis.on('reconnecting', failed);
    this.subscriber.on('error', failed);
    this.subscriber.on('reconnecting', failed);
    await Promise.all([this.redis.connect(), this.subscriber.connect()]);
    await this.subscriber.subscribe(`${PREFIX}request:${this.nodeId}`, (message) => {
      void tenantStorage.exit(() => this.receive(message)).catch(() => this.logger.warn('Voice RPC request rejected'));
    });
    await this.subscriber.subscribe(`${PREFIX}reply:${this.nodeId}`, (message) => {
      try {
        const reply = JSON.parse(message) as RpcReply;
        const pending = this.pending.get(reply.id);
        if (!pending || pending.owner !== reply.owner) return;
        clearTimeout(pending.timer);
        this.pending.delete(reply.id);
        pending.resolve(reply.result);
      } catch { this.logger.warn('Invalid voice RPC reply'); }
    });
    this.heartbeat = setInterval(() => {
      // Fence locally BEFORE waiting for Redis: a partition cannot keep media alive.
      for (const [key, renewed] of this.leases) if (Date.now() - renewed >= FENCE_MS) this.lose(key);
      void this.renew().catch(failed);
    }, 1000);
    this.heartbeat.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const key of [...this.leases.keys()]) { this.lose(key); await this.release(key).catch(() => undefined); }
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Голосовой сервер остановлен')); }
    this.pending.clear();
    if (this.subscriber?.isOpen) await this.subscriber.quit();
    if (this.redis?.isOpen) await this.redis.quit();
  }

  async execute(request: VoiceRequest): Promise<VoiceReply> {
    const key = voiceRoomKey(request.peer.tenantId, request.body.roomId);
    if (!this.redis) {
      if (process.env.TENANCY_ENABLED === 'true') throw new Error('Голосовой кластер недоступен');
      return this.local(key, request);
    }
    if (!this.redis.isReady || !this.subscriber?.isReady) throw new Error('Голосовой кластер недоступен');
    let owner = await this.redis.get(`${PREFIX}owner:${key}`);
    if (!owner) {
      const acquiredAt = Date.now();
      const acquired = await this.redis.set(`${PREFIX}owner:${key}`, this.nodeId, { NX: true, PX: LEASE_MS });
      if (acquired) { this.leases.set(key, acquiredAt); owner = this.nodeId; }
      else owner = await this.redis.get(`${PREFIX}owner:${key}`);
    }
    if (!owner) throw new Error('Повторите подключение к комнате');
    if (owner === this.nodeId) return this.local(key, request);
    if (this.pending.size >= 1000) throw new Error('Голосовой сервер занят');
    const id = randomUUID();
    return new Promise<VoiceReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Голосовой сервер не ответил. Подключитесь повторно'));
      }, TIMEOUT_MS);
      this.pending.set(id, { owner, resolve, reject, timer });
      const envelope: RpcRequest = { id, source: this.nodeId, owner, deadline: Date.now() + TIMEOUT_MS, request };
      void this.redis!.publish(`${PREFIX}request:${owner}`, JSON.stringify(envelope)).catch(() => {
        clearTimeout(timer); this.pending.delete(id); reject(new Error('Голосовой кластер недоступен'));
      });
    });
  }

  async assertOwnership(key: string): Promise<void> {
    if (!this.redis && process.env.TENANCY_ENABLED !== 'true') return;
    const renewed = this.leases.get(key);
    if (!this.redis?.isReady || !renewed || Date.now() - renewed >= FENCE_MS ||
      await this.redis.get(`${PREFIX}owner:${key}`) !== this.nodeId) {
      this.lose(key);
      throw new Error('Голосовая сессия завершена. Подключитесь повторно');
    }
  }

  async publishPresence(key: string, participants: VoiceParticipantSummary[]): Promise<void> {
    if (!this.redis) return;
    await this.redis.eval(PRESENCE_WRITE, {
      keys: [`${PREFIX}owner:${key}`, `${PREFIX}presence:${key}`],
      arguments: [this.nodeId, JSON.stringify(participants), String(LEASE_MS)],
    });
  }

  async presence(key: string): Promise<VoiceParticipantSummary[] | undefined> {
    if (!this.redis) return undefined;
    // Presence is optional decoration. A Redis failure must not hide room CRUD.
    try {
      if (!this.redis.isReady || !await this.redis.get(`${PREFIX}owner:${key}`)) return [];
      const raw = await this.redis.get(`${PREFIX}presence:${key}`);
      return raw ? JSON.parse(raw) as VoiceParticipantSummary[] : [];
    } catch { return []; }
  }

  async release(key: string): Promise<void> {
    this.leases.delete(key);
    if (this.redis?.isReady) await this.redis.eval(OWNER_RELEASE, {
      keys: [`${PREFIX}owner:${key}`, `${PREFIX}presence:${key}`], arguments: [this.nodeId],
    });
  }

  private lose(key: string): void {
    this.leases.delete(key);
    this.lost?.(key);
  }

  private local(key: string, request: VoiceRequest): Promise<VoiceReply> {
    return this.serialized(key, async () => {
      if (!this.handler) throw new Error('Голосовой сервер недоступен');
      return tenantStorage.exit(() => this.handler!(request));
    });
  }

  async inspect(key: string, inspect: () => Promise<void>): Promise<void> {
    await this.serialized(key, async () => { await inspect(); return {}; });
  }

  private serialized(key: string, callback: () => Promise<VoiceReply>): Promise<VoiceReply> {
    const count = this.queued.get(key) ?? 0;
    if (count >= 100) return Promise.reject(new Error('Голосовой сервер занят'));
    this.queued.set(key, count + 1);
    const previous = this.queues.get(key) ?? Promise.resolve({});
    const next = previous.catch(() => ({})).then(async () => {
      await this.assertOwnership(key);
      return callback();
    });
    this.queues.set(key, next);
    void next.finally(() => {
      const remaining = (this.queued.get(key) ?? 1) - 1;
      if (remaining) this.queued.set(key, remaining); else this.queued.delete(key);
      if (this.queues.get(key) === next) this.queues.delete(key);
    }).catch(() => undefined);
    return next;
  }

  private async receive(message: string): Promise<void> {
    if (Buffer.byteLength(message) > 100000) return;
    const envelope = JSON.parse(message) as RpcRequest;
    if (envelope.owner !== this.nodeId || !/^[a-f0-9-]{36}$/.test(envelope.source) ||
      !/^[a-f0-9-]{36}$/.test(envelope.id) || envelope.deadline < Date.now() ||
      envelope.deadline > Date.now() + TIMEOUT_MS + 1000) return;
    const key = voiceRoomKey(envelope.request.peer.tenantId, envelope.request.body.roomId);
    await this.assertOwnership(key);
    const cacheKey = `${envelope.source}:${envelope.id}`;
    let cached = this.completed.get(cacheKey);
    if (!cached) {
      const reply = this.local(key, envelope.request).catch(() => ({ error: 'Нет доступа к голосовой сессии' }));
      cached = { deadline: envelope.deadline + TIMEOUT_MS, reply };
      this.completed.set(cacheKey, cached);
    }
    const result = await cached.reply;
    const reply: RpcReply = { id: envelope.id, owner: this.nodeId, result };
    await this.redis!.publish(`${PREFIX}reply:${envelope.source}`, JSON.stringify(reply));
  }

  private async renew(): Promise<void> {
    if (this.renewing || !this.redis?.isReady) return;
    this.renewing = true;
    try {
      for (const [key, last] of this.leases) {
        if (Date.now() - last < 5000) continue;
        const started = Date.now();
        const renewed = await this.redis.eval(OWNER_RENEW, {
          keys: [`${PREFIX}owner:${key}`], arguments: [this.nodeId, String(LEASE_MS)],
        });
        // A delayed result cannot resurrect an already fenced SFU.
        if (renewed && this.leases.get(key) === last && Date.now() - started < FENCE_MS) this.leases.set(key, started);
        else this.lose(key);
      }
      for (const [id, item] of this.completed) if (item.deadline < Date.now()) this.completed.delete(id);
    } finally { this.renewing = false; }
  }
}
