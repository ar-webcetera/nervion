/** Итоговый статус доставки исходящего письма (Postbox). */
export enum MailDeliveryStatus {
  SENT = "sent",
  DELIVERED = "delivered",
  BOUNCED = "bounced",
  COMPLAINED = "complained",
}

/** Системная папка почтовой цепочки. */
export enum MailSystemFolder {
  INBOX = "inbox",
  SPAM = "spam",
  TRASH = "trash",
}

/** Область ручного правила фильтрации спама. */
export enum MailSpamRuleScope {
  SENDER = "sender",
  DOMAIN = "domain",
}

/** Тип события доставки/вовлечённости из Postbox. */
export enum MailDeliveryEventType {
  SEND = "Send",
  DELIVERY = "Delivery",
  BOUNCE = "Bounce",
  COMPLAINT = "Complaint",
  OPEN = "Open",
  CLICK = "Click",
  DELIVERY_DELAY = "DeliveryDelay",
  RENDERING_FAILURE = "Rendering Failure",
  SUBSCRIPTION = "Subscription",
}
