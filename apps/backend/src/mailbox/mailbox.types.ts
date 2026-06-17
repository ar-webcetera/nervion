import { MailAddress, MailAuthResults } from './entities/mail-message.entity';

export interface InboundAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
  contentId?: string | null;
  isInline?: boolean;
}

// Нормализованное входящее письмо — то, что SMTP-приёмник передаёт сервису
export interface InboundMailData {
  messageId: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string | null;
  text: string | null;
  html: string | null;
  rawS3Key: string | null;
  authResults: MailAuthResults | null;
  attachments: InboundAttachment[];
}
