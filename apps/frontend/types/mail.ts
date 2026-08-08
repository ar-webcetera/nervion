import type { MailDeliveryStatus } from '@tracker/contracts';

export enum MAIL_ACCOUNT_TYPES {
  personal = 'personal',
  service = 'service',
}

export enum MAIL_DIRECTIONS {
  inbound = 'inbound',
  outbound = 'outbound',
}

export type { MailDeliveryStatus };

export interface MailAccountUser {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
}

export interface MailAccount {
  id: number;
  address: string;
  display_name: string | null;
  type: MAIL_ACCOUNT_TYPES;
  user_id: number | null;
  is_active: boolean;
  signature_html: string | null;
  allowedUsers?: MailAccountUser[];
}

export interface MailAddressItem {
  address: string;
  name?: string;
}

export interface MailAttachment {
  id: number;
  filename: string;
  content_type: string;
  size: number;
  s3_key: string;
  content_id: string | null;
  is_inline: boolean;
}

export interface MailMessage {
  id: number;
  thread_id: number;
  direction: MAIL_DIRECTIONS;
  from_address: string;
  from_name: string | null;
  to_addresses: MailAddressItem[];
  cc_addresses: MailAddressItem[];
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  is_read: boolean;
  status: 'received' | 'sent' | 'failed' | 'draft';
  delivery_status?: MailDeliveryStatus | null;
  first_opened_at?: string | null;
  open_count?: number;
  click_count?: number;
  last_delivery_event_at?: string | null;
  createdAt: string;
  sender_avatar_url?: string | null;
  attachments?: MailAttachment[];
}

export interface MailThread {
  id: number;
  subject: string;
  account_id: number;
  folder: 'inbox' | 'trash';
  counterparty_address: string | null;
  counterparty_avatar_url?: string | null;
  last_message_at: string;
  account?: MailAccount;
  unread_count?: number;
  delivery_status?: MailDeliveryStatus | null;
  open_count?: number;
  click_count?: number;
}

export interface SendMailPayload {
  account_id: number;
  to: string[];
  cc?: string[];
  subject: string;
  html?: string;
  text?: string;
  thread_id?: number;
  attachments?: MailAttachmentDescriptor[];
}

export interface MailAttachmentDescriptor {
  s3_key: string;
  filename: string;
  content_type: string;
  size: number;
  content_id?: string | null;
  is_inline?: boolean;
}

export interface MailAccountPayload {
  address: string;
  display_name?: string | null;
  type?: MAIL_ACCOUNT_TYPES;
  user_id?: number | null;
  is_active?: boolean;
  signature_html?: string | null;
  allowedUserIds?: number[];
}
