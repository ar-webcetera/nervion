import { randomUUID } from 'crypto';
import { Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { Attachment } from 'nodemailer/lib/mailer';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS-модуль, esModuleInterop в проекте выключен
import MailComposer = require('nodemailer/lib/mail-composer');
import { TenantMailConfigService } from './tenant-mail-config.service';

export interface PostboxSendParams {
  from: { address: string; name?: string | null };
  to: string[];
  cc?: string[];
  subject: string;
  html?: string;
  text?: string;
  inReplyTo?: string | null;
  references?: string | null;
  attachments?: Attachment[];
  messageId?: string;
  headers?: Record<string, string>;
}

export interface PostboxSendResult {
  /** RFC Message-ID без угловых скобок (наш заголовок). */
  messageId: string;
  /** MessageId из ответа Postbox — им матчим delivery-события. */
  providerMessageId: string | null;
}

const DEFAULT_POSTBOX_ENDPOINT = 'https://postbox.cloud.yandex.net';
const DEFAULT_POSTBOX_REGION = 'ru-central1';
export const NERVION_MESSAGE_TAG = 'nervion-message-id';

/**
 * Значение EmailTag для Postbox/SES: только [A-Za-z0-9_-], ≤256 символов.
 * В тег кладём UUID из Message-ID (часть до @) — иначе `uuid@domain` даёт tag value is invalid.
 */
export function toNervionMessageTagValue(messageId: string): string {
  const local = messageId.replace(/^<|>$/g, '').trim().split('@')[0] ?? '';
  return local.replace(/[^0-9A-Za-z_-]/g, '').slice(0, 256);
}

@Injectable()
export class PostboxService {
  private readonly logger = new Logger(PostboxService.name);
  private client: SESv2Client | null = null;
  private readonly tenantClients = new Map<string, SESv2Client>();

  constructor(private readonly configService: ConfigService, @Optional() private readonly tenantMail?: TenantMailConfigService) {}

  private getClient(): SESv2Client {
    if (this.configService.get<string>('TENANCY_ENABLED') === 'true') {
      if (!this.tenantMail) throw new ServiceUnavailableException('Почта пространства не настроена');
      const configuration = this.tenantMail.current();
      let client = this.tenantClients.get(configuration.tenantId);
      if (!client) {
        client = new SESv2Client({
          endpoint: DEFAULT_POSTBOX_ENDPOINT,
          region: DEFAULT_POSTBOX_REGION,
          credentials: { accessKeyId: configuration.accessKeyId, secretAccessKey: configuration.secretAccessKey },
          // SendEmail has no idempotency token. A network retry could send twice.
          maxAttempts: 1,
          requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
        });
        this.tenantClients.set(configuration.tenantId, client);
      }
      return client;
    }
    const accessKeyId = this.configService.get<string>('POSTBOX_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('POSTBOX_SECRET_ACCESS_KEY');

    if (!accessKeyId || !secretAccessKey) {
      throw new ServiceUnavailableException('Отправка почты не настроена (POSTBOX_ACCESS_KEY_ID/POSTBOX_SECRET_ACCESS_KEY)');
    }

    if (!this.client) {
      this.client = new SESv2Client({
        endpoint: this.configService.get<string>('POSTBOX_ENDPOINT') || DEFAULT_POSTBOX_ENDPOINT,
        region: this.configService.get<string>('POSTBOX_REGION') || DEFAULT_POSTBOX_REGION,
        credentials: { accessKeyId, secretAccessKey },
      });
    }

    return this.client;
  }

  generateMessageId(): string {
    const domain = this.configService.get<string>('TENANCY_ENABLED') === 'true'
      ? this.tenantMail?.current().domains[0]
      : this.configService.get<string>('MAILBOX_DOMAIN') || 'example.com';
    if (!domain) throw new ServiceUnavailableException('Почта пространства не настроена');

    return `${randomUUID()}@${domain}`;
  }

  async send(params: PostboxSendParams): Promise<PostboxSendResult> {
    this.tenantMail?.assertSender(params.from.address);
    const client = this.getClient();
    const messageId = (params.messageId || this.generateMessageId()).replace(/^<|>$/g, '').trim();
    const configurationSetName = this.configService.get<string>('TENANCY_ENABLED') === 'true'
      ? this.tenantMail?.current().configurationSet
      : this.configService.get<string>('POSTBOX_CONFIGURATION_SET')?.trim() || undefined;

    const composer = new MailComposer({
      from: params.from.name ? { name: params.from.name, address: params.from.address } : params.from.address,
      to: params.to,
      cc: params.cc && params.cc.length > 0 ? params.cc : undefined,
      subject: params.subject,
      html: params.html,
      text: params.text,
      inReplyTo: params.inReplyTo ? `<${params.inReplyTo}>` : undefined,
      references: params.references || undefined,
      messageId: `<${messageId}>`,
      headers: params.headers,
      attachments: params.attachments,
    });

    const raw = await composer.compile().build();

    const response = await client.send(
      new SendEmailCommand({
        FromEmailAddress: params.from.address,
        Destination: {
          ToAddresses: params.to,
          CcAddresses: params.cc && params.cc.length > 0 ? params.cc : undefined,
        },
        Content: { Raw: { Data: raw } },
        ConfigurationSetName: configurationSetName,
        EmailTags: [{ Name: NERVION_MESSAGE_TAG, Value: toNervionMessageTagValue(messageId) }],
      }),
    );

    const providerMessageId = response.MessageId?.trim() || null;
    this.logger.log(
      `Письмо отправлено через Postbox: ${messageId}` +
        (providerMessageId ? ` (provider=${providerMessageId})` : ''),
    );

    return { messageId, providerMessageId };
  }
}
