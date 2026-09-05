import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Not, Repository } from 'typeorm';
import * as Sentry from '@sentry/nestjs';
import { MailMessages, MAIL_DIRECTIONS, MAIL_MESSAGE_STATUSES } from './entities/mail-message.entity';

const CHECK_INTERVAL_MS = 5 * 60_000;
const EVENT_GRACE_MS = 15 * 60_000;
const LOOKBACK_MS = 24 * 60 * 60_000;
const ALERT_INTERVAL_MS = 60 * 60_000;

@Injectable()
export class MailDeliveryMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailDeliveryMonitorService.name);
  private timer?: NodeJS.Timeout;
  private checking = false;
  private lastMissingAlert = 0;
  private lastCheckErrorAlert = 0;

  constructor(
    @InjectRepository(MailMessages) private readonly messages: Repository<MailMessages>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<string>('SENTRY_DSN') || !this.config.get<string>('POSTBOX_CONFIGURATION_SET')) return;
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.timer.unref();
    void this.check();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    const now = Date.now();
    try {
      const missing = await this.messages.count({
        where: {
          direction: MAIL_DIRECTIONS.outbound,
          status: MAIL_MESSAGE_STATUSES.sent,
          provider_message_id: Not(IsNull()),
          last_delivery_event_at: IsNull(),
          createdAt: Between(new Date(now - LOOKBACK_MS), new Date(now - EVENT_GRACE_MS)),
          deleted_at: IsNull(),
        },
      });
      this.lastCheckErrorAlert = 0;
      if (!missing) {
        this.lastMissingAlert = 0;
      } else if (!this.lastMissingAlert || now - this.lastMissingAlert >= ALERT_INTERVAL_MS) {
        Sentry.captureMessage('Postbox: нет событий для отправленных писем более 15 минут', {
          level: 'error',
          fingerprint: ['mail-delivery-events-missing'],
          tags: { monitor: 'mail-delivery', component: 'postbox-events' },
          extra: { affected_messages: missing, grace_minutes: 15, lookback_hours: 24 },
        });
        this.lastMissingAlert = now;
        this.logger.error(`Нет событий Postbox для ${missing} отправленных писем`);
      }
    } catch {
      // Do not include database errors: they can contain SQL or connection details.
      if (!this.lastCheckErrorAlert || now - this.lastCheckErrorAlert >= ALERT_INTERVAL_MS) {
        Sentry.captureMessage('Не удалось проверить поступление событий Postbox', {
          level: 'error',
          fingerprint: ['mail-delivery-monitor-failed'],
          tags: { monitor: 'mail-delivery' },
        });
        this.lastCheckErrorAlert = now;
      }
    } finally {
      this.checking = false;
    }
  }
}
