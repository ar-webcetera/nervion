export interface MailUnreadCounts {
  /** Непрочитанные во «Входящих» (то же, что `inbox`; для бейджа в меню). */
  count: number;
  inbox: number;
  trash: number;
}
