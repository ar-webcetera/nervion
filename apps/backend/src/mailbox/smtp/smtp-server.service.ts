import { createHash, randomUUID } from 'crypto';
import { readFileSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticate } from 'mailauth';
import { AddressObject, simpleParser } from 'mailparser';
import { SMTPServer, SMTPServerAddress, SMTPServerDataStream, SMTPServerSession } from 'smtp-server';
import { MailAddress, MailAuthResults } from '../entities/mail-message.entity';
import { StorageService } from '../../storage/storage.service';
import { MailboxService } from '../mailbox.service';
import { InboundMailData } from '../mailbox.types';
import { parseTaskIdFromAddress, normalizeMessageId } from '../mailbox.utils';
import { TenantMailConfigService } from '../tenant-mail-config.service';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { MailAccounts } from '../entities/mail-account.entity';

const DEFAULT_SMTP_PORT = 25;
const MAX_MESSAGE_SIZE = 26214400; // 25 MB

function flattenAddresses(value?: AddressObject | AddressObject[]): MailAddress[] {
  const objects = Array.isArray(value) ? value : value ? [value] : [];

  return objects.flatMap((obj) =>
    (obj.value ?? [])
      .filter((item) => Boolean(item.address))
      .map((item) => ({ address: item.address!.toLowerCase(), name: item.name || undefined })),
  );
}

@Injectable()
export class SmtpServerService {
  private readonly logger = new Logger(SmtpServerService.name);
  private server: SMTPServer | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly mailboxService: MailboxService,
    private readonly storageService: StorageService,
    private readonly tenantMail: TenantMailConfigService,
    private readonly database: TenantDatabaseService,
  ) {}

  private get domain(): string {
    return (this.configService.get<string>('MAILBOX_DOMAIN') || 'example.com').toLowerCase();
  }

  listen(): void {
    const port = Number(this.configService.get<string>('SMTP_PORT')) || DEFAULT_SMTP_PORT;
    const certPath = this.configService.get<string>('SMTP_TLS_CERT_FILE');
    const keyPath = this.configService.get<string>('SMTP_TLS_KEY_FILE');
    if (Boolean(certPath) !== Boolean(keyPath))
      throw new Error('SMTP TLS certificate and private key must be configured together');
    if (this.tenantMail.isEnabled() && this.configService.get<string>('NODE_ENV') === 'production' && (!certPath || !keyPath)) {
      throw new Error('Production SaaS SMTP requires SMTP_TLS_CERT_FILE and SMTP_TLS_KEY_FILE');
    }

    this.server = new SMTPServer({
      banner: 'Tracker Mail',
      ...(certPath && keyPath ? { cert: readFileSync(certPath), key: readFileSync(keyPath) } : {}),
      maxClients: 20,
      socketTimeout: 60_000,
      disabledCommands: ['AUTH'],
      authOptional: true,
      size: MAX_MESSAGE_SIZE,
      onRcptTo: (address, session, callback) => {
        this.validateRecipient(address)
          .then((accepted) => {
            if (accepted) {
              callback();
            } else {
              callback(Object.assign(new Error('Mailbox not found'), { responseCode: 550 }));
            }
          })
          .catch((error) => {
            this.logger.error(`Ошибка проверки получателя ${address.address}: ${error}`);
            callback(Object.assign(new Error('Temporary failure'), { responseCode: 451 }));
          });
      },
      onData: (stream, session, callback) => {
        this.handleMessage(stream, session)
          .then(() => callback())
          .catch((error) => {
            this.logger.error(`Ошибка обработки письма: ${error instanceof Error ? error.stack : error}`);
            callback(Object.assign(new Error('Temporary processing failure'), { responseCode: 451 }));
          });
      },
    });

    this.server.on('error', (error) => {
      this.logger.error(`SMTP server error: ${error.message}`);
    });

    this.server.listen(port, () => {
      this.logger.log(`SMTP-приёмник слушает порт ${port} для домена ${this.domain}`);
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  private async validateRecipient(address: SMTPServerAddress): Promise<boolean> {
    if (!this.tenantMail.isEnabled()) return address.address.toLowerCase().endsWith(`@${this.domain}`);
    const tenant = await this.tenantMail.resolveRecipient(address.address);
    if (!tenant) return false;
    return this.database.run(tenant, async () => Boolean(await this.accountForRecipient(address.address)), { readOnly: true });
  }

  private async accountForRecipient(recipient: string): Promise<MailAccounts | null> {
    return parseTaskIdFromAddress(recipient) !== null
      ? this.mailboxService.findTaskAliasAccount()
      : this.mailboxService.findAccountByAddress(recipient);
  }

  private async handleMessage(stream: SMTPServerDataStream, session: SMTPServerSession): Promise<void> {
    const chunks: Buffer[] = [];
    let bytes = 0;

    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      bytes += buffer.length;
      if (bytes > MAX_MESSAGE_SIZE) throw new Error('Message size exceeded');
      chunks.push(buffer);
    }

    if (stream.sizeExceeded) {
      throw new Error('Message size exceeded');
    }

    const raw = Buffer.concat(chunks);
    const authResults = await this.authenticateMessage(raw, session);
    const parsed = await simpleParser(raw);

    const rawS3Key = this.tenantMail.isEnabled() ? null : await this.uploadRaw(raw);
    const notificationHeader = parsed.headers.get('x-nervion-notification-id');
    const notificationId =
      typeof notificationHeader === 'string' && /^\d+$/.test(notificationHeader.trim()) ? Number(notificationHeader) : null;

    const data: InboundMailData = {
      messageId: normalizeMessageId(parsed.messageId),
      // A public MIME header is not proof of a trusted internal notification.
      notificationId: this.tenantMail.isEnabled() ? null : notificationId,
      inReplyTo: normalizeMessageId(parsed.inReplyTo),
      referencesHeader: Array.isArray(parsed.references) ? parsed.references.join(' ') : (parsed.references ?? null),
      from: flattenAddresses(parsed.from)[0] ?? {
        address: session.envelope.mailFrom ? session.envelope.mailFrom.address.toLowerCase() : 'unknown@unknown',
      },
      to: flattenAddresses(parsed.to),
      cc: flattenAddresses(parsed.cc),
      subject: parsed.subject ?? null,
      text: parsed.text ?? null,
      html: typeof parsed.html === 'string' ? parsed.html : null,
      rawS3Key,
      authResults,
      attachments: (parsed.attachments ?? []).map((attachment) => ({
        filename: attachment.filename || 'attachment',
        contentType: attachment.contentType || 'application/octet-stream',
        size: attachment.size,
        content: attachment.content,
        contentId: attachment.cid ?? null,
        isInline: attachment.contentDisposition === 'inline',
      })),
    };

    const envelopeRecipients = session.envelope.rcptTo.map((rcpt) => rcpt.address.toLowerCase());
    const targetAccountIds = new Set<string>();

    for (const recipient of envelopeRecipients) {
      if (this.tenantMail.isEnabled()) {
        const tenant = await this.tenantMail.resolveRecipient(recipient);
        if (!tenant) throw new Error('Tenant recipient is unavailable');
        await this.database.run(tenant, async () => {
          const account = await this.accountForRecipient(recipient);
          if (!account) throw new Error('Mailbox is unavailable');
          const key = `${tenant.id}:${account.id}`;
          if (targetAccountIds.has(key)) return;
          targetAccountIds.add(key);
          await this.mailboxService.ingestInbound(account, {
            ...data,
            messageId: data.messageId || `${createHash('sha256').update(raw).digest('hex')}@smtp.nervion.local`,
            rawS3Key: await this.uploadRaw(raw),
            to: data.to.some((item) => item.address === recipient) ? data.to : [...data.to, { address: recipient }],
          });
        });
        continue;
      }
      const account =
        parseTaskIdFromAddress(recipient) !== null
          ? ((await this.mailboxService.findTaskAliasAccount()) ??
            (await this.mailboxService.findOrCreateInboundAccount(recipient)))
          : await this.mailboxService.findOrCreateInboundAccount(recipient);

      if (targetAccountIds.has(String(account.id))) {
        continue;
      }

      targetAccountIds.add(String(account.id));

      const dataForAccount: InboundMailData =
        data.to.some((item) => item.address === recipient) || data.cc.some((item) => item.address === recipient)
          ? data
          : { ...data, to: [...data.to, { address: recipient }] };

      await this.mailboxService.ingestInbound(account, dataForAccount);
    }

    this.logger.log(`Принято письмо (${targetAccountIds.size} ящиков)`);
  }

  private async authenticateMessage(raw: Buffer, session: SMTPServerSession): Promise<MailAuthResults | null> {
    try {
      const result = await authenticate(raw, {
        ip: session.remoteAddress,
        helo: session.clientHostname,
        sender: session.envelope.mailFrom ? session.envelope.mailFrom.address : undefined,
        mta: this.domain,
      });

      return {
        spf: result?.spf?.status?.result,
        dkim: result?.dkim?.results?.[0]?.status?.result,
        dmarc: result?.dmarc?.status?.result,
      };
    } catch (error) {
      this.logger.warn(`SPF/DKIM проверка не удалась: ${error}`);
      return null;
    }
  }

  private async uploadRaw(raw: Buffer): Promise<string | null> {
    try {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const id = this.tenantMail.isEnabled() ? createHash('sha256').update(raw).digest('hex') : randomUUID();
      const key = `mailbox/raw/${month}/${id}.eml`;

      await this.storageService.uploadObject(key, raw, 'message/rfc822');

      return key;
    } catch {
      this.logger.error('Не удалось сохранить raw-письмо в S3');
      if (this.tenantMail.isEnabled()) throw new Error('Incoming mail storage unavailable');
      return null;
    }
  }
}
