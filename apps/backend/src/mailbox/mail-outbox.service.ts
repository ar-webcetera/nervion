import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { SESv2ServiceException } from '@aws-sdk/client-sesv2';
import { MailDeliveryStatus } from '@tracker/contracts';
import { PlatformService } from '../platform/platform.service';
import { TenantContextService, tenantStorage } from '../tenancy/tenant-context.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { StorageService } from '../storage/storage.service';
import { MailMessages, MAIL_MESSAGE_STATUSES } from './entities/mail-message.entity';
import { MailOutboxStatus } from './entities/mail-outbox.entity';
import { PostboxService } from './postbox.service';
import { TenantMailConfigService } from './tenant-mail-config.service';
import { Users } from '../users/entities/users.entity';
import { canAccessAccount } from './mailbox.utils';

@Injectable()
export class MailOutboxService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MailOutboxService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly context: TenantContextService,
    private readonly database: TenantDatabaseService,
    private readonly platform: PlatformService,
    private readonly configuration: TenantMailConfigService,
    private readonly postbox: PostboxService,
    private readonly storage: StorageService,
    @InjectRepository(MailMessages) private readonly messages: Repository<MailMessages>,
  ) {}

  async enqueue(messageId: number): Promise<void> {
    const { manager, tenant } = this.context.require();
    if (tenant.readOnly) throw new Error('Read-only tenant cannot queue mail');
    this.configuration.current();
    await manager.query(`INSERT INTO mail_outbox (id, message_id) VALUES ($1, $2) ON CONFLICT (tenant_id, message_id) DO NOTHING`, [randomUUID(), messageId]);
  }

  onApplicationBootstrap(): void {
    if (!this.context.isEnabled()) return;
    this.timer = setInterval(() => void this.tick(), 5_000);
    this.timer.unref();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  async tick(): Promise<void> {
    // A caller must not turn a durable claim into a nested, uncommitted request
    // transaction. Every sweep owns its fresh transactions, including manual runs.
    return tenantStorage.exit(() => this.tickDetached());
  }

  private async tickDetached(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const snapshot of await this.platform.listRunnableTenants()) {
        if (snapshot.readOnly || snapshot.featureFlags.mail !== true) continue;
        try {
          for (let index = 0; index < 10; index += 1) {
            const tenant = await this.platform.getTenant(snapshot.id);
            if (tenant.readOnly || tenant.featureFlags.mail !== true) break;
            // The durable claim commits BEFORE the external send. Other replicas
            // never resend it, even if the first worker crashes after acceptance.
            const row = await this.database.run(tenant, async () => {
              const { manager } = this.context.require();
              await manager.query(`WITH abandoned AS (
                UPDATE mail_outbox SET status = 'uncertain', last_error = 'Worker stopped during delivery'
                WHERE status = 'sending' AND claimed_at < now() - interval '15 minutes' RETURNING message_id
              ) UPDATE mail_messages SET status = 'uncertain' WHERE id IN (SELECT message_id FROM abandoned) AND status = 'sending'`);
              const rows = await manager.query<Array<{ id: string; message_id: number }>>(`SELECT id, message_id FROM mail_outbox WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
              if (!rows[0]) return null;
              await manager.query("UPDATE mail_outbox SET status = 'sending', claimed_at = now() WHERE id = $1", [rows[0].id]);
              await this.messages.update(rows[0].message_id, { status: MAIL_MESSAGE_STATUSES.sending });
              return rows[0];
            });
            if (!row) break;
            let dispatched = false;
            try {
              const current = await this.platform.getTenant(tenant.id);
              if (current.readOnly || current.featureFlags.mail !== true) throw new Error('Mail was disabled after queue claim');
              await this.database.run(current, async () => {
                const message = await this.messages.findOne({ where: { id: row.message_id }, relations: { thread: { account: true }, attachments: true } });
                if (!message || message.deleted_at || !message.thread.account.is_active) throw new Error('Mail no longer available');
                this.configuration.assertSender(message.from_address);
                const attachments: Array<{ filename: string; content: Buffer; contentType: string; cid?: string; contentDisposition?: 'inline' }> = [];
                let totalBytes = 0;
                for (const attachment of message.attachments ?? []) {
                  const object = await this.storage.getObjectStream(attachment.s3_key);
                  const chunks: Buffer[] = [];
                  for await (const chunk of object.body as AsyncIterable<Buffer>) {
                    totalBytes += chunk.length;
                    if (totalBytes > 7_000_000) { object.body.destroy(); throw new Error('Attachments too large'); }
                    chunks.push(chunk);
                  }
                  attachments.push({ filename: attachment.filename, content: Buffer.concat(chunks), contentType: attachment.content_type,
                    ...(attachment.content_id ? { cid: attachment.content_id } : {}), ...(attachment.is_inline ? { contentDisposition: 'inline' as const } : {}) });
                }
                // Loading S3 objects may take time. Re-read both platform policy
                // and the account's current ACL immediately before network I/O.
                const freshTenant = await this.platform.getTenant(current.id);
                if (freshTenant.readOnly || freshTenant.featureFlags.mail !== true)
                  throw new Error('Mail was disabled before delivery');
                const freshMessage = await this.messages.findOne({
                  where: { id: message.id }, relations: { thread: { account: { allowedUsers: true } } },
                });
                if (!freshMessage || freshMessage.deleted_at || freshMessage.status !== MAIL_MESSAGE_STATUSES.sending ||
                  !freshMessage.thread.account.is_active || freshMessage.thread.account.address !== message.from_address)
                  throw new Error('Mail sender or queued message is no longer available');
                await this.assertSenderAccess(freshMessage);
                dispatched = true;
                const result = await this.postbox.send({
                  from: { address: message.from_address, name: message.from_name },
                  to: message.to_addresses.map((address) => address.address), cc: message.cc_addresses.map((address) => address.address),
                  subject: message.subject || '', text: message.text_body || undefined, html: message.html_body || undefined,
                  inReplyTo: message.in_reply_to, references: message.references_header, messageId: message.message_id || undefined, attachments,
                });
                await this.messages.update(message.id, { provider_message_id: result.providerMessageId, status: MAIL_MESSAGE_STATUSES.sent });
                await this.context.require().manager.query(`UPDATE mail_messages SET delivery_status = $2 WHERE id = $1 AND delivery_status IS NULL`, [message.id, MailDeliveryStatus.SENT]);
                await this.context.require().manager.query("UPDATE mail_outbox SET status = 'sent', last_error = NULL WHERE id = $1", [row.id]);
              });
            } catch (error) {
              // No blind retry after network I/O: Postbox SendEmail is not idempotent.
              const rejected = error instanceof SESv2ServiceException &&
                (error.$metadata.httpStatusCode || 0) >= 400 && (error.$metadata.httpStatusCode || 0) < 500;
              const status = dispatched && !rejected ? MailOutboxStatus.UNCERTAIN : MailOutboxStatus.FAILED;
              const maintenanceTenant = await this.platform.getTenant(tenant.id);
              // A suspended/read-only tenant cannot be made writable with the
              // old claim snapshot. Its unfinished claim is reconciled on resume.
              if (maintenanceTenant.readOnly) break;
              await this.database.run(maintenanceTenant, async () => {
                await this.context.require().manager.query(`UPDATE mail_outbox SET status = $2, last_error = $3 WHERE id = $1 AND status = 'sending'`,
                  [row.id, status, status === MailOutboxStatus.UNCERTAIN ? 'Acceptance could not be confirmed; inspect provider events before retry' : 'Provider rejected the request or delivery preparation failed']);
                await this.context.require().manager.query(`UPDATE mail_messages SET status = $2::mail_message_status_enum WHERE id = $1 AND status = 'sending'`, [row.message_id, status]);
              });
              this.logger.warn(`Mail delivery ${status}: tenant=${tenant.id}, outbox=${row.id}`);
            }
          }
        } catch { this.logger.error(`Mail outbox unavailable: tenant=${snapshot.id}`); }
      }
    } catch { this.logger.error('Mail outbox cannot resolve spaces'); }
    finally { this.running = false; }
  }

  private async assertSenderAccess(message: MailMessages): Promise<void> {
    const { tenant, manager } = this.context.require();
    if (message.sent_by_user_id === null) {
      // Null actor is reserved for the server's configured notification account.
      if (message.thread.account.address !== this.configuration.current().notificationAccount)
        throw new Error('System mail requires the configured notification account');
      return;
    }
    if (!Number.isSafeInteger(message.sent_by_user_id) || message.sent_by_user_id < 1)
      throw new Error('Mail actor is missing');
    const membership = await this.platform.assertMembership(tenant.id, message.sent_by_user_id);
    const actor = await manager.getRepository(Users).findOneBy({ id: message.sent_by_user_id });
    if (!actor || membership.role !== String(actor.role) || !canAccessAccount(actor, message.thread.account))
      throw new Error('Mail sender no longer has access to the account');
  }
}
