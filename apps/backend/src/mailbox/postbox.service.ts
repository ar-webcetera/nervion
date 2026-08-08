import { randomUUID } from 'crypto';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { Attachment } from 'nodemailer/lib/mailer';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS-модуль, esModuleInterop в проекте выключен
import MailComposer = require('nodemailer/lib/mail-composer');

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
}

export interface PostboxSendResult {
  /** RFC Message-ID без угловых скобок (наш заголовок). */
  messageId: string;
  /** MessageId из ответа Postbox — им матчим delivery-события. */
  providerMessageId: string | null;
}

const DEFAULT_POSTBOX_ENDPOINT = 'https://postbox.cloud.yandex.net';
const DEFAULT_POSTBOX_REGION = 'ru-central1';
const NERVION_MESSAGE_TAG = 'nervion-message-id';

@Injectable()
export class PostboxService {
  private readonly logger = new Logger(PostboxService.name);
  private client: SESv2Client | null = null;

  constructor(private readonly configService: ConfigService) {}

  private getClient(): SESv2Client {
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
    const domain = this.configService.get<string>('MAILBOX_DOMAIN') || 'example.com';

    return `${randomUUID()}@${domain}`;
  }

  async send(params: PostboxSendParams): Promise<PostboxSendResult> {
    const client = this.getClient();
    const messageId = this.generateMessageId();
    const configurationSetName = this.configService.get<string>('POSTBOX_CONFIGURATION_SET')?.trim() || undefined;

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
        EmailTags: [{ Name: NERVION_MESSAGE_TAG, Value: messageId }],
      }),
    );

    const providerMessageId = response.MessageId?.trim() || null;
    this.logger.log(
      `Письмо отправлено через Postbox: ${messageId}` +
        (providerMessageId ? ` (provider=${providerMessageId})` : '') +
        ` -> ${params.to.join(', ')}`,
    );

    return { messageId, providerMessageId };
  }
}
