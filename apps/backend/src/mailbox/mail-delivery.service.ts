import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  MailDeliveryEventType,
  MailDeliveryStatus,
  type MailStatsAccountRow,
  type MailStatsProblemMessage,
  type MailStatsResponse,
  type JsonObject,
} from '@tracker/contracts';
import { Repository } from 'typeorm';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { MailDeliveryEvents } from './entities/mail-delivery-event.entity';
import { MailMessages, MAIL_DIRECTIONS, MAIL_MESSAGE_STATUSES } from './entities/mail-message.entity';
import { MailAccounts } from './entities/mail-account.entity';
import type { PostboxEventPayload, PostboxEventsIngestBody, PostboxKinesisRecord } from './postbox-events.types';

const NERVION_MESSAGE_TAG = 'nervion-message-id';

const STATUS_RANK: Record<MailDeliveryStatus, number> = {
  [MailDeliveryStatus.SENT]: 1,
  [MailDeliveryStatus.DELIVERED]: 2,
  [MailDeliveryStatus.BOUNCED]: 3,
  [MailDeliveryStatus.COMPLAINED]: 4,
};

@Injectable()
export class MailDeliveryService {
  private readonly logger = new Logger(MailDeliveryService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(MailMessages)
    private readonly messagesRepository: Repository<MailMessages>,
    @InjectRepository(MailDeliveryEvents)
    private readonly eventsRepository: Repository<MailDeliveryEvents>,
    @InjectRepository(MailAccounts)
    private readonly accountsRepository: Repository<MailAccounts>,
  ) {}

  assertWebhookSecret(headerValue: string | undefined): void {
    const expected = this.configService.get<string>('POSTBOX_EVENTS_WEBHOOK_SECRET')?.trim();
    if (!expected) {
      throw new UnauthorizedException('Приём событий Postbox не настроен (POSTBOX_EVENTS_WEBHOOK_SECRET)');
    }
    const token = headerValue?.replace(/^Bearer\s+/i, '').trim();
    if (!token || token !== expected) {
      throw new UnauthorizedException('Неверный секрет webhook Postbox');
    }
  }

  async ingestPayload(body: PostboxEventsIngestBody): Promise<{ accepted: number; ignored: number }> {
    const events = this.extractEvents(body);
    let accepted = 0;
    let ignored = 0;

    for (const event of events) {
      const applied = await this.applyEvent(event);
      if (applied) accepted += 1;
      else ignored += 1;
    }

    return { accepted, ignored };
  }

  private extractEvents(body: PostboxEventsIngestBody): PostboxEventPayload[] {
    if (!body || typeof body !== 'object') {
      return [];
    }

    if (typeof body.eventType === 'string' && body.mail) {
      return [body as PostboxEventPayload];
    }

    if (Array.isArray(body.events)) {
      return body.events.filter((item): item is PostboxEventPayload => Boolean(item && typeof item === 'object'));
    }

    if (Array.isArray(body.messages)) {
      return body.messages.flatMap((message) => this.decodeStreamMessage(message));
    }

    if (Array.isArray(body.Records)) {
      return body.Records.flatMap((record) => this.decodeKinesisRecord(record));
    }

    return [];
  }

  private decodeStreamMessage(
    message: PostboxEventPayload | string | { data?: string },
  ): PostboxEventPayload[] {
    if (!message) return [];

    if (typeof message === 'string') {
      try {
        const parsed: unknown = JSON.parse(message);
        if (parsed && typeof parsed === 'object') {
          return this.extractEvents(parsed as PostboxEventsIngestBody);
        }
      } catch {
        return [];
      }
      return [];
    }

    if (typeof message === 'object' && 'eventType' in message && message.mail) {
      return [message];
    }

    if (typeof message === 'object' && 'data' in message && typeof message.data === 'string') {
      try {
        const text = Buffer.from(message.data, 'base64').toString('utf8');
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          return this.extractEvents(parsed as PostboxEventsIngestBody);
        }
      } catch (error) {
        this.logger.warn(`Не удалось разобрать messages[].data: ${String(error)}`);
      }
    }

    return [];
  }

  private decodeKinesisRecord(record: PostboxKinesisRecord): PostboxEventPayload[] {
    const raw = record.kinesis?.data ?? record.Data;
    if (!raw) return [];

    try {
      const text =
        typeof raw === 'string'
          ? Buffer.from(raw, 'base64').toString('utf8')
          : Buffer.from(raw).toString('utf8');
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is PostboxEventPayload => Boolean(item && typeof item === 'object'));
      }
      if (parsed && typeof parsed === 'object') {
        return [parsed as PostboxEventPayload];
      }
    } catch (error) {
      this.logger.warn(`Не удалось разобрать запись Data Streams: ${String(error)}`);
    }

    return [];
  }

  private async applyEvent(event: PostboxEventPayload): Promise<boolean> {
    const eventType = event.eventType?.trim();
    if (!eventType || !event.mail) {
      return false;
    }

    const message = await this.findMessageForEvent(event);
    if (!message) {
      this.logger.warn(
        `Событие Postbox ${eventType} без письма: provider=${event.mail.messageId ?? '—'}, eventId=${event.eventId ?? '—'}`,
      );
      return false;
    }

    const providerEventId = event.eventId?.trim() || null;
    if (providerEventId) {
      const existing = await this.eventsRepository.findOne({ where: { provider_event_id: providerEventId } });
      if (existing) {
        return false;
      }
    }

    const occurredAt = this.resolveOccurredAt(event);
    const meta = this.buildMeta(event);

    try {
      await this.eventsRepository.save(
        this.eventsRepository.create({
          message_id: message.id,
          event_type: eventType,
          provider_event_id: providerEventId,
          occurred_at: occurredAt,
          meta,
        }),
      );
    } catch (error) {
      // Гонка по unique provider_event_id
      this.logger.debug(`Пропуск дубля события ${providerEventId}: ${String(error)}`);
      return false;
    }

    await this.updateMessageSnapshot(message, eventType, occurredAt);
    return true;
  }

  private async findMessageForEvent(event: PostboxEventPayload): Promise<MailMessages | null> {
    const providerMessageId = event.mail?.messageId?.trim();
    if (providerMessageId) {
      const byProvider = await this.messagesRepository.findOne({
        where: { provider_message_id: providerMessageId, direction: MAIL_DIRECTIONS.outbound },
      });
      if (byProvider) return byProvider;
    }

    const tagIds = event.mail?.tags?.[NERVION_MESSAGE_TAG] ?? [];
    for (const rawId of tagIds) {
      const messageId = this.normalizeMessageId(rawId);
      if (!messageId) continue;
      const byTag = await this.messagesRepository.findOne({
        where: { message_id: messageId, direction: MAIL_DIRECTIONS.outbound },
      });
      if (byTag) return byTag;
    }

    const headerId = this.normalizeMessageId(event.mail?.commonHeaders?.messageId);
    if (headerId && headerId.includes('@')) {
      const byHeader = await this.messagesRepository.findOne({
        where: { message_id: headerId, direction: MAIL_DIRECTIONS.outbound },
      });
      if (byHeader) return byHeader;
    }

    return null;
  }

  private normalizeMessageId(value: string | undefined | null): string | null {
    if (!value) return null;
    return value.replace(/^<|>$/g, '').trim() || null;
  }

  private resolveOccurredAt(event: PostboxEventPayload): Date {
    const candidates = [
      event.open?.timestamp,
      event.click?.timestamp,
      event.bounce?.timestamp,
      event.complaint?.timestamp,
      event.delivery?.timestamp,
      event.mail?.timestamp,
    ];
    for (const value of candidates) {
      if (!value) continue;
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return new Date();
  }

  private buildMeta(event: PostboxEventPayload): JsonObject {
    const meta: JsonObject = {};
    if (event.open) meta.open = { ...event.open };
    if (event.click) meta.click = { ...event.click };
    if (event.bounce) {
      meta.bounce = {
        bounceType: event.bounce.bounceType ?? null,
        bounceSubType: event.bounce.bounceSubType ?? null,
        timestamp: event.bounce.timestamp ?? null,
      };
    }
    if (event.complaint) {
      meta.complaint = {
        timestamp: event.complaint.timestamp ?? null,
        complaintFeedbackType: event.complaint.complaintFeedbackType ?? null,
      };
    }
    if (event.delivery) meta.delivery = { ...event.delivery };
    if (event.mail?.tags) {
      meta.tags = Object.fromEntries(
        Object.entries(event.mail.tags).map(([key, values]) => [key, [...values]]),
      );
    }
    return meta;
  }

  private async updateMessageSnapshot(message: MailMessages, eventType: string, occurredAt: Date): Promise<void> {
    const patch: Partial<MailMessages> = {
      last_delivery_event_at: this.maxDate(message.last_delivery_event_at, occurredAt),
    };

    if (eventType === MailDeliveryEventType.DELIVERY) {
      patch.delivery_status = this.pickHigherStatus(message.delivery_status, MailDeliveryStatus.DELIVERED);
    } else if (eventType === MailDeliveryEventType.BOUNCE) {
      patch.delivery_status = this.pickHigherStatus(message.delivery_status, MailDeliveryStatus.BOUNCED);
    } else if (eventType === MailDeliveryEventType.COMPLAINT) {
      patch.delivery_status = this.pickHigherStatus(message.delivery_status, MailDeliveryStatus.COMPLAINED);
    } else if (eventType === MailDeliveryEventType.OPEN) {
      patch.open_count = (message.open_count ?? 0) + 1;
      patch.first_opened_at = message.first_opened_at ?? occurredAt;
      if (!message.delivery_status || message.delivery_status === MailDeliveryStatus.SENT) {
        patch.delivery_status = MailDeliveryStatus.DELIVERED;
      }
    } else if (eventType === MailDeliveryEventType.CLICK) {
      patch.click_count = (message.click_count ?? 0) + 1;
      if (!message.delivery_status || message.delivery_status === MailDeliveryStatus.SENT) {
        patch.delivery_status = MailDeliveryStatus.DELIVERED;
      }
    } else if (eventType === MailDeliveryEventType.SEND && !message.delivery_status) {
      patch.delivery_status = MailDeliveryStatus.SENT;
    }

    await this.messagesRepository.update({ id: message.id }, patch);
    Object.assign(message, patch);
  }

  private pickHigherStatus(
    current: MailDeliveryStatus | null | undefined,
    next: MailDeliveryStatus,
  ): MailDeliveryStatus {
    if (!current) return next;
    return STATUS_RANK[next] >= STATUS_RANK[current] ? next : current;
  }

  private maxDate(a: Date | null | undefined, b: Date): Date {
    if (!a) return b;
    return a.getTime() >= b.getTime() ? a : b;
  }

  async getStats(
    user: AuthenticatedUser,
    options: { accountId?: number; from?: string; to?: string } = {},
  ): Promise<MailStatsResponse> {
    const { from, to } = this.resolvePeriod(options.from, options.to);
    const accessibleAccountIds = await this.getAccessibleAccountIds(user, options.accountId);

    const emptyTotals = {
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      complained: 0,
      open_rate: 0,
      click_rate: 0,
      bounce_rate: 0,
      complaint_rate: 0,
    };

    if (accessibleAccountIds.length === 0) {
      return { from: from.toISOString(), to: to.toISOString(), totals: emptyTotals, by_account: [], problems: [] };
    }

    const rows = await this.messagesRepository
      .createQueryBuilder('message')
      .innerJoin('message.thread', 'thread')
      .innerJoin('thread.account', 'account')
      .select('account.id', 'account_id')
      .addSelect('account.address', 'address')
      .addSelect('account.display_name', 'display_name')
      .addSelect('COUNT(*)::int', 'sent')
      .addSelect(
        `COUNT(*) FILTER (WHERE message.delivery_status IN (:...deliveredStatuses)
          OR message.open_count > 0 OR message.click_count > 0)::int`,
        'delivered',
      )
      .addSelect('COUNT(*) FILTER (WHERE message.open_count > 0)::int', 'opened')
      .addSelect('COUNT(*) FILTER (WHERE message.click_count > 0)::int', 'clicked')
      .addSelect(`COUNT(*) FILTER (WHERE message.delivery_status = :bounced)::int`, 'bounced')
      .addSelect(`COUNT(*) FILTER (WHERE message.delivery_status = :complained)::int`, 'complained')
      .where('message.direction = :outbound', { outbound: MAIL_DIRECTIONS.outbound })
      .andWhere('message.status = :sentStatus', { sentStatus: MAIL_MESSAGE_STATUSES.sent })
      .andWhere('message.deleted_at IS NULL')
      .andWhere('thread.account_id IN (:...accountIds)', { accountIds: accessibleAccountIds })
      .andWhere('message.created_at >= :from', { from })
      .andWhere('message.created_at < :to', { to })
      .setParameters({
        deliveredStatuses: [MailDeliveryStatus.DELIVERED, MailDeliveryStatus.COMPLAINED],
        bounced: MailDeliveryStatus.BOUNCED,
        complained: MailDeliveryStatus.COMPLAINED,
      })
      .groupBy('account.id')
      .addGroupBy('account.address')
      .addGroupBy('account.display_name')
      .orderBy('account.address', 'ASC')
      .getRawMany<{
        account_id: string;
        address: string;
        display_name: string | null;
        sent: string;
        delivered: string;
        opened: string;
        clicked: string;
        bounced: string;
        complained: string;
      }>();

    const by_account: MailStatsAccountRow[] = rows.map((row) => ({
      account_id: Number(row.account_id),
      address: row.address,
      display_name: row.display_name,
      sent: Number(row.sent),
      delivered: Number(row.delivered),
      opened: Number(row.opened),
      clicked: Number(row.clicked),
      bounced: Number(row.bounced),
      complained: Number(row.complained),
    }));

    const totalsBase = by_account.reduce(
      (acc, row) => {
        acc.sent += row.sent;
        acc.delivered += row.delivered;
        acc.opened += row.opened;
        acc.clicked += row.clicked;
        acc.bounced += row.bounced;
        acc.complained += row.complained;
        return acc;
      },
      { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 },
    );

    const rate = (value: number) => (totalsBase.sent > 0 ? Math.round((value / totalsBase.sent) * 1000) / 10 : 0);

    const problemRows = await this.messagesRepository
      .createQueryBuilder('message')
      .innerJoin('message.thread', 'thread')
      .innerJoin('thread.account', 'account')
      .select([
        'message.id AS id',
        'message.thread_id AS thread_id',
        'account.id AS account_id',
        'account.address AS account_address',
        'message.subject AS subject',
        'message.to_addresses AS to_addresses',
        'message.delivery_status AS delivery_status',
        'message.created_at AS created_at',
        'message.last_delivery_event_at AS last_delivery_event_at',
      ])
      .where('message.direction = :outbound', { outbound: MAIL_DIRECTIONS.outbound })
      .andWhere('message.status = :sentStatus', { sentStatus: MAIL_MESSAGE_STATUSES.sent })
      .andWhere('message.deleted_at IS NULL')
      .andWhere('thread.account_id IN (:...accountIds)', { accountIds: accessibleAccountIds })
      .andWhere('message.created_at >= :from', { from })
      .andWhere('message.created_at < :to', { to })
      .andWhere('message.delivery_status IN (:...problemStatuses)', {
        problemStatuses: [MailDeliveryStatus.BOUNCED, MailDeliveryStatus.COMPLAINED],
      })
      .orderBy('message.last_delivery_event_at', 'DESC', 'NULLS LAST')
      .addOrderBy('message.created_at', 'DESC')
      .limit(20)
      .getRawMany<{
        id: string;
        thread_id: string;
        account_id: string;
        account_address: string;
        subject: string | null;
        to_addresses: Array<{ address: string }> | string;
        delivery_status: MailDeliveryStatus;
        created_at: Date | string;
        last_delivery_event_at: Date | string | null;
      }>();

    const problems: MailStatsProblemMessage[] = problemRows.map((row) => {
      const toAddresses = typeof row.to_addresses === 'string' ? JSON.parse(row.to_addresses) : row.to_addresses;
      return {
        id: Number(row.id),
        thread_id: Number(row.thread_id),
        account_id: Number(row.account_id),
        account_address: row.account_address,
        subject: row.subject,
        to_addresses: (Array.isArray(toAddresses) ? toAddresses : []).map((item: { address: string }) => item.address),
        delivery_status: row.delivery_status,
        created_at: new Date(row.created_at).toISOString(),
        last_delivery_event_at: row.last_delivery_event_at ? new Date(row.last_delivery_event_at).toISOString() : null,
      };
    });

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        ...totalsBase,
        open_rate: rate(totalsBase.opened),
        click_rate: rate(totalsBase.clicked),
        bounce_rate: rate(totalsBase.bounced),
        complaint_rate: rate(totalsBase.complained),
      },
      by_account,
      problems,
    };
  }

  private resolvePeriod(fromRaw?: string, toRaw?: string): { from: Date; to: Date } {
    const to = toRaw ? new Date(toRaw) : new Date();
    const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      const fallbackTo = new Date();
      return { from: new Date(fallbackTo.getTime() - 30 * 24 * 60 * 60 * 1000), to: fallbackTo };
    }
    // верхняя граница exclusive: если передали дату без времени — следующий день
    const toExclusive =
      toRaw && /^\d{4}-\d{2}-\d{2}$/.test(toRaw)
        ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() + 1))
        : to;
    return { from, to: toExclusive };
  }

  private async getAccessibleAccountIds(user: AuthenticatedUser, accountId?: number): Promise<number[]> {
    // Как в UI почты: только ящики с явным доступом через mail_account_access.
    const query = this.accountsRepository
      .createQueryBuilder('account')
      .select('account.id', 'id')
      .innerJoin('mail_account_access', 'access', 'access.mail_account_id = account.id')
      .where('access.user_id = :userId', { userId: user.id })
      .andWhere('account.is_active = true');

    if (accountId) {
      query.andWhere('account.id = :accountId', { accountId });
    }

    const rows = await query.getRawMany<{ id: string }>();
    return rows.map((row) => Number(row.id));
  }

  async attachDeliverySummaries(
    threadIds: number[],
  ): Promise<Map<number, { delivery_status: MailDeliveryStatus | null; open_count: number; click_count: number }>> {
    const result = new Map<
      number,
      { delivery_status: MailDeliveryStatus | null; open_count: number; click_count: number }
    >();
    if (threadIds.length === 0) return result;

    const rows = await this.messagesRepository
      .createQueryBuilder('message')
      .distinctOn(['message.thread_id'])
      .select([
        'message.thread_id AS thread_id',
        'message.delivery_status AS delivery_status',
        'message.open_count AS open_count',
        'message.click_count AS click_count',
      ])
      .where('message.thread_id IN (:...threadIds)', { threadIds })
      .andWhere('message.direction = :outbound', { outbound: MAIL_DIRECTIONS.outbound })
      .andWhere('message.status = :sentStatus', { sentStatus: MAIL_MESSAGE_STATUSES.sent })
      .andWhere('message.deleted_at IS NULL')
      .orderBy('message.thread_id', 'ASC')
      .addOrderBy('message.id', 'DESC')
      .getRawMany<{
        thread_id: string;
        delivery_status: MailDeliveryStatus | null;
        open_count: string;
        click_count: string;
      }>();

    for (const row of rows) {
      result.set(Number(row.thread_id), {
        delivery_status: row.delivery_status,
        open_count: Number(row.open_count) || 0,
        click_count: Number(row.click_count) || 0,
      });
    }

    return result;
  }
}
