import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Not, Repository } from 'typeorm';
import * as Sentry from '@sentry/nestjs';
import { MailMessages, MAIL_DIRECTIONS, MAIL_MESSAGE_STATUSES } from './entities/mail-message.entity';
import { TenantJobsService } from '../tenancy/tenant-jobs.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { TenantMailConfigService } from './tenant-mail-config.service';

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
  private readonly alerts = new Map<string, { missing: number; error: number }>();

  constructor(
    @InjectRepository(MailMessages) private readonly messages: Repository<MailMessages>,
    private readonly config: ConfigService,
    @Optional() private readonly jobs?: TenantJobsService,
    @Optional() private readonly context?: TenantContextService,
    @Optional() private readonly tenantMail?: TenantMailConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('TENANCY_ENABLED') === 'true') {
      if (!this.jobs || !this.context || !this.tenantMail) throw new Error('Tenant mail monitor dependencies are missing');
      this.jobs.register('mail.delivery-monitor', () => this.check());
      this.jobs.schedule('mail.delivery-monitor', async () => {
        const { tenant } = this.context!.require();
        if (tenant.featureFlags.mail !== true) return;
        try { if (!this.tenantMail!.current().configurationSet) return; } catch { return; }
        await this.jobs!.enqueue('mail.delivery-monitor', `mail.delivery-monitor:${Math.floor(Date.now() / CHECK_INTERVAL_MS)}`);
      });
      return;
    }
    if (!this.config.get<string>('SENTRY_DSN') || !this.config.get<string>('POSTBOX_CONFIGURATION_SET')) return;
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.timer.unref();
    void this.check();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async check(): Promise<void> {
    if (this.config.get<string>('TENANCY_ENABLED') === 'true' && this.context?.require().tenant.featureFlags.mail !== true) return;
    if (this.checking) return;
    this.checking = true;
    const now = Date.now();
    const tenantId = this.config.get<string>('TENANCY_ENABLED') === 'true' ? this.context?.require().tenant.id : undefined;
    const previous = tenantId ? this.alerts.get(tenantId) : undefined;
    if (tenantId) { this.lastMissingAlert = previous?.missing || 0; this.lastCheckErrorAlert = previous?.error || 0; }
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
          tags: { monitor: 'mail-delivery', component: 'postbox-events', ...(tenantId ? { tenant_id: tenantId } : {}) },
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
      if (tenantId) this.alerts.set(tenantId, { missing: this.lastMissingAlert, error: this.lastCheckErrorAlert });
      this.checking = false;
    }
  }
}
