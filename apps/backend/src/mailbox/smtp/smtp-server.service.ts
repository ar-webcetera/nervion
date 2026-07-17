import { randomUUID } from 'crypto';
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
  ) {}

  private get domain(): string {
    return (this.configService.get<string>('MAILBOX_DOMAIN') || 'example.com').toLowerCase();
  }

  listen(): void {
    const port = Number(this.configService.get<string>('SMTP_PORT')) || DEFAULT_SMTP_PORT;

    this.server = new SMTPServer({
      banner: 'Tracker Mail',
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

  private validateRecipient(address: SMTPServerAddress): Promise<boolean> {
    return Promise.resolve(address.address.toLowerCase().endsWith(`@${this.domain}`));
  }

  private async handleMessage(stream: SMTPServerDataStream, session: SMTPServerSession): Promise<void> {
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }

    if (stream.sizeExceeded) {
      throw new Error('Message size exceeded');
    }

    const raw = Buffer.concat(chunks);
    const authResults = await this.authenticateMessage(raw, session);
    const parsed = await simpleParser(raw);

    const rawS3Key = await this.uploadRaw(raw);

    const data: InboundMailData = {
      messageId: normalizeMessageId(parsed.messageId),
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
    const targetAccountIds = new Set<number>();

    for (const recipient of envelopeRecipients) {
      const account =
        parseTaskIdFromAddress(recipient) !== null
          ? ((await this.mailboxService.findTaskAliasAccount()) ??
            (await this.mailboxService.findOrCreateInboundAccount(recipient)))
          : await this.mailboxService.findOrCreateInboundAccount(recipient);

      if (targetAccountIds.has(account.id)) {
        continue;
      }

      targetAccountIds.add(account.id);

      const dataForAccount: InboundMailData =
        data.to.some((item) => item.address === recipient) || data.cc.some((item) => item.address === recipient)
          ? data
          : { ...data, to: [...data.to, { address: recipient }] };

      await this.mailboxService.ingestInbound(account, dataForAccount);
    }

    this.logger.log(`Принято письмо от ${data.from.address} для ${envelopeRecipients.join(', ')} (${targetAccountIds.size} ящ.)`);
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
      const key = `mailbox/raw/${month}/${randomUUID()}.eml`;

      await this.storageService.uploadObject(key, raw, 'message/rfc822');

      return key;
    } catch (error) {
      this.logger.error(`Не удалось сохранить raw-письмо в S3: ${error}`);
      return null;
    }
  }
}
