import { MailDeliveryStatus } from '@tracker/contracts';

export type MailDeliveryTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent';

export interface MailDeliveryLabel {
  text: string;
  tone: MailDeliveryTone;
  title: string;
}

export const resolveMailDeliveryLabel = (input: {
  status?: 'received' | 'sent' | 'failed' | 'draft' | null;
  delivery_status?: MailDeliveryStatus | null;
  open_count?: number | null;
  click_count?: number | null;
}): MailDeliveryLabel | null => {
  if (input.status === 'failed') {
    return { text: 'не отправлено', tone: 'danger', title: 'Postbox не принял письмо' };
  }
  if (input.status === 'draft' || input.status === 'received') {
    return null;
  }

  if (input.delivery_status === MailDeliveryStatus.COMPLAINED) {
    return { text: 'жалоба', tone: 'danger', title: 'Получатель пожаловался на спам' };
  }
  if (input.delivery_status === MailDeliveryStatus.BOUNCED) {
    return { text: 'не доставлено', tone: 'warn', title: 'Сервер получателя отклонил письмо' };
  }

  const openCount = input.open_count ?? 0;
  const clickCount = input.click_count ?? 0;
  if (openCount > 0 || clickCount > 0) {
    const parts = ['открыто'];
    if (clickCount > 0) parts.push('есть клик');
    return {
      text: parts.join(' · '),
      tone: 'accent',
      title: 'Есть признаки открытия (трекинг-pixel). Это не гарантия прочтения.',
    };
  }

  if (input.delivery_status === MailDeliveryStatus.DELIVERED) {
    return { text: 'доставлено', tone: 'ok', title: 'Почтовый сервер получателя принял письмо' };
  }

  if (input.status === 'sent' || input.delivery_status === MailDeliveryStatus.SENT) {
    return { text: 'отправлено', tone: 'neutral', title: 'Письмо ушло через Postbox, подтверждения доставки ещё нет' };
  }

  return null;
};
