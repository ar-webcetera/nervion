import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterFactory?: ReturnType<typeof createAdapter>;
  private publisher?: ReturnType<typeof createClient>;
  private subscriber?: ReturnType<typeof createClient>;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connect(url: string): Promise<void> {
    this.publisher = createClient({ url, socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 3000) } });
    this.subscriber = this.publisher.duplicate();
    this.publisher.on('error', () => this.logger.error('Realtime Redis publisher connection failed'));
    this.subscriber.on('error', () => this.logger.error('Realtime Redis subscriber connection failed'));
    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
    this.adapterFactory = createAdapter(this.publisher, this.subscriber);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, { ...options, transports: ['websocket'] }) as Server;
    if (!this.adapterFactory) throw new Error('Redis adapter is not ready');
    server.adapter(this.adapterFactory);
    return server;
  }

  async dispose(): Promise<void> {
    if (this.publisher?.isOpen) await this.publisher.quit();
    if (this.subscriber?.isOpen) await this.subscriber.quit();
    await super.dispose();
  }
}
