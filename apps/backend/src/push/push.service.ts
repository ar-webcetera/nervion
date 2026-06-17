import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as webpush from 'web-push';
import { ConfigService } from '@nestjs/config';
import { PushSubscription } from './entities/push-subscription.entity';
import { SaveSubscriptionDto } from './dto/save-subscription.dto';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @InjectRepository(PushSubscription)
    private readonly subscriptionRepo: Repository<PushSubscription>,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    const subject = `https://${this.configService.get<string>('APP_DOMAIN') ?? 'localhost'}`;
    const publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY') ?? '';
    const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY') ?? '';
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  getVapidPublicKey(): string {
    return this.configService.get<string>('VAPID_PUBLIC_KEY') ?? '';
  }

  async saveSubscription(userId: number, dto: SaveSubscriptionDto): Promise<void> {
    await this.subscriptionRepo.upsert(
      { user_id: userId, endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth },
      ['endpoint'],
    );
  }

  async removeSubscription(userId: number, endpoint: string): Promise<void> {
    await this.subscriptionRepo.delete({ user_id: userId, endpoint });
  }

  async sendToUser(userId: number, payload: PushPayload): Promise<void> {
    const subs = await this.subscriptionRepo.findBy({ user_id: userId });
    await Promise.all(subs.map((s) => this.send(s, payload)));
  }

  async sendToUsers(userIds: number[], payload: PushPayload): Promise<void> {
    if (!userIds.length) return;
    const subs = await this.subscriptionRepo.find({ where: { user_id: In(userIds) } });
    await Promise.all(subs.map((s) => this.send(s, payload)));
  }

  private async send(sub: PushSubscription, payload: PushPayload): Promise<void> {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        await this.subscriptionRepo.delete({ endpoint: sub.endpoint });
      } else {
        this.logger.warn(`Push failed for user ${sub.user_id}: ${String(err)}`);
      }
    }
  }
}
