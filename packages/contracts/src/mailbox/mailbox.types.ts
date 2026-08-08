import type { MailDeliveryStatus } from './mailbox.enums';

export interface MailUnreadCounts {
  /** Непрочитанные во «Входящих» (то же, что `inbox`; для бейджа в меню). */
  count: number;
  inbox: number;
  trash: number;
}

/** Сводка доставки на исходящем письме / в списке «Отправленные». */
export interface MailDeliveryInfo {
  status: MailDeliveryStatus | null;
  first_opened_at: string | null;
  open_count: number;
  click_count: number;
  last_delivery_event_at: string | null;
}

export interface MailStatsAccountRow {
  account_id: number;
  address: string;
  display_name: string | null;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
}

export interface MailStatsProblemMessage {
  id: number;
  thread_id: number;
  account_id: number;
  account_address: string;
  subject: string | null;
  to_addresses: string[];
  delivery_status: MailDeliveryStatus;
  created_at: string;
  last_delivery_event_at: string | null;
}

export interface MailStatsResponse {
  from: string;
  to: string;
  totals: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    complained: number;
    open_rate: number;
    click_rate: number;
    bounce_rate: number;
    complaint_rate: number;
  };
  by_account: MailStatsAccountRow[];
  problems: MailStatsProblemMessage[];
}
