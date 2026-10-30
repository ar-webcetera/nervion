import { GoneException, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as webpush from 'web-push';
import { ConfigService } from '@nestjs/config';
import { PushSubscription } from './entities/push-subscription.entity';
import { SaveSubscriptionDto } from './dto/save-subscription.dto';
import { requireTenantContext } from '../tenancy/tenant-context.service';

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

  private isEnabled(): boolean {
    return this.configService.get<string>('PUSH_ENABLED') !== 'false';
  }

  private assertEnabled(): void {
    if (!this.isEnabled()) throw new ServiceUnavailableException('Push-уведомления отключены на этом сервере');
  }

  onModuleInit() {
    if (!this.isEnabled()) return;
    const subject = `https://${this.configService.get<string>('APP_DOMAIN') ?? 'localhost'}`;
    const publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY') ?? '';
    const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY') ?? '';
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  getVapidPublicKey(): string {
    if (!this.isEnabled()) return '';
    return this.configService.get<string>('VAPID_PUBLIC_KEY') ?? '';
  }

  async saveSubscription(userId: number, dto: SaveSubscriptionDto): Promise<void> {
    this.assertEnabled();
    if (this.configService.get<string>('TENANCY_ENABLED') === 'true') {
      await this.subscriptionRepo.query(
        `
        INSERT INTO push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (tenant_id, endpoint) DO UPDATE SET
          user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
      `,
        [requireTenantContext().tenant.id, userId, dto.endpoint, dto.keys.p256dh, dto.keys.auth],
      );
      return;
    }
    await this.subscriptionRepo.upsert(
      { user_id: userId, endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth },
      ['endpoint'],
    );
  }

  async removeSubscription(userId: number, endpoint: string): Promise<void> {
    await this.subscriptionRepo.delete({ user_id: userId, endpoint });
  }

  async sendToUser(userId: number, payload: PushPayload): Promise<void> {
    if (!this.isEnabled()) return;
    const subs = await this.subscriptionRepo.findBy({ user_id: userId });
    await Promise.all(subs.map((s) => this.send(s, payload)));
  }

  async sendToUsers(userIds: number[], payload: PushPayload): Promise<void> {
    if (!this.isEnabled()) return;
    if (!userIds.length) return;
    const subs = await this.subscriptionRepo.find({ where: { user_id: In(userIds) } });
    await Promise.all(subs.map((s) => this.send(s, payload)));
  }

  async sendTest(userId: number, endpoint: string): Promise<void> {
    this.assertEnabled();
    const subscription = await this.subscriptionRepo.findOneBy({ user_id: userId, endpoint });
    if (!subscription) throw new NotFoundException('Подписка не найдена. Включите уведомления повторно.');
    await this.send(
      subscription,
      {
        title: 'Уведомления работают',
        body: 'Это проверочное уведомление Нервион для этого устройства.',
        url: '/',
        tag: 'push-test',
      },
      true,
    );
  }

  private async send(sub: PushSubscription, payload: PushPayload, reportFailure = false): Promise<void> {
    if (!this.isEnabled()) {
      if (reportFailure) this.assertEnabled();
      return;
    }
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { timeout: 10000 },
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        await this.subscriptionRepo.delete({ endpoint: sub.endpoint });
        if (reportFailure) throw new GoneException('Подписка истекла. Выключите и снова включите уведомления.');
      } else {
        this.logger.warn(`Push failed for user ${sub.user_id}: ${String(err)}`);
        if (reportFailure) throw new ServiceUnavailableException('Push-сервис недоступен. Повторите проверку позже.');
      }
    }
  }
}
