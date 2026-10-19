import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { CalendarParticipationStatus, type CalendarEvent, type CalendarParticipant, type CalendarUser } from '@tracker/contracts';
import { DataSource, In, Repository } from 'typeorm';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ROLES } from '../common/enums/roles.enum';
import { buildPublicAppUrl } from '../common/utils/public-app-url';
import { NotificationsService } from '../notifications/notifications.service';
import { Users } from '../users/entities/users.entity';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { GetCalendarEventsDto } from './dto/get-calendar-events.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';
import { CalendarEventEntity } from './entities/calendar-event.entity';
import { CalendarEventParticipant } from './entities/calendar-event-participant.entity';
import { CalendarEventReminder } from './entities/calendar-event-reminder.entity';

const REMINDER_POLL_INTERVAL_MS = 30_000;
const MAX_RANGE_MS = 62 * 24 * 60 * 60 * 1000;

@Injectable()
export class CalendarService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CalendarService.name);
  private reminderTimer: NodeJS.Timeout | null = null;
  private processingReminders = false;

  constructor(
    @InjectRepository(CalendarEventEntity)
    private readonly eventRepo: Repository<CalendarEventEntity>,
    @InjectRepository(CalendarEventReminder)
    private readonly reminderRepo: Repository<CalendarEventReminder>,
    @InjectRepository(CalendarEventParticipant)
    private readonly participantRepo: Repository<CalendarEventParticipant>,
    @InjectRepository(Users)
    private readonly userRepo: Repository<Users>,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    void this.processDueReminders();
    this.reminderTimer = setInterval(() => void this.processDueReminders(), REMINDER_POLL_INTERVAL_MS);
    this.reminderTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.reminderTimer) clearInterval(this.reminderTimer);
  }

  async findAll(filters: GetCalendarEventsDto): Promise<CalendarEvent[]> {
    const from = new Date(filters.from);
    const to = new Date(filters.to);
    if (to <= from) throw new BadRequestException('Дата окончания периода должна быть позже даты начала.');
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw new BadRequestException('За один запрос можно получить не больше 62 дней.');
    }

    const events = await this.eventRepo
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.creator', 'creator')
      .leftJoinAndSelect('event.participant_links', 'participant_link')
      .leftJoinAndSelect('participant_link.user', 'participant')
      .where('event.start_at < :to', { to })
      .andWhere('event.end_at > :from', { from })
      .orderBy('event.start_at', 'ASC')
      .addOrderBy('event.id', 'ASC')
      .getMany();

    return events.map((event) => this.toContract(event));
  }

  async findUsers(): Promise<CalendarUser[]> {
    const users = await this.userRepo.find({
      where: { role: In([ROLES.admin, ROLES.employee]) },
      order: { first_name: 'ASC', last_name: 'ASC' },
    });
    return users.map((user) => this.toCalendarUser(user));
  }

  async create(dto: CreateCalendarEventDto, currentUser: AuthenticatedUser): Promise<CalendarEvent> {
    const input = this.validateInput(dto);
    const participantIds = await this.validateParticipantIds(dto.participant_ids, currentUser.id);

    const eventId = await this.dataSource.transaction(async (manager) => {
      const event = manager.create(CalendarEventEntity, {
        title: input.title,
        notes: input.notes,
        start_at: input.startAt,
        end_at: input.endAt,
        timezone: input.timezone,
        reminder_minutes: input.reminderMinutes,
        creator_id: currentUser.id,
      });
      const saved = await manager.save(event);
      await manager.insert(
        CalendarEventParticipant,
        participantIds.map((userId) => ({
          event_id: saved.id,
          user_id: userId,
          participation_status:
            userId === currentUser.id ? CalendarParticipationStatus.accepted : CalendarParticipationStatus.invited,
          responded_at: userId === currentUser.id ? new Date() : null,
        })),
      );
      await manager.insert(
        CalendarEventReminder,
        participantIds.map((userId) => ({
          event_id: saved.id,
          user_id: userId,
          remind_at: this.getReminderDate(input.startAt, input.reminderMinutes),
          sent_at: null,
          processing_at: null,
          attempts: 0,
        })),
      );
      return saved.id;
    });

    const event = await this.findOne(eventId);
    await this.notifyInvitedParticipants(
      event,
      participantIds.filter((userId) => userId !== currentUser.id),
    );
    return event;
  }

  async update(id: number, dto: UpdateCalendarEventDto, currentUser: AuthenticatedUser): Promise<CalendarEvent> {
    const existing = await this.findEntity(id);
    this.assertCanManage(existing, currentUser);

    const participantIds = await this.validateParticipantIds(
      dto.participant_ids ?? existing.participant_links.map((participant) => participant.user_id),
      existing.creator_id,
    );
    const input = this.validateInput({
      title: dto.title ?? existing.title,
      notes: dto.notes === undefined ? existing.notes : dto.notes,
      start_at: dto.start_at ?? existing.start_at.toISOString(),
      end_at: dto.end_at ?? existing.end_at.toISOString(),
      timezone: dto.timezone ?? existing.timezone,
      reminder_minutes: dto.reminder_minutes ?? existing.reminder_minutes,
      participant_ids: participantIds,
    });
    const existingReminders = await this.reminderRepo.findBy({ event_id: id });
    const existingParticipants = new Map(existing.participant_links.map((participant) => [participant.user_id, participant]));
    const invitedParticipantIds = participantIds.filter(
      (userId) => userId !== existing.creator_id && !existingParticipants.has(userId),
    );
    const nextRemindAt = this.getReminderDate(input.startAt, input.reminderMinutes);

    await this.dataSource.transaction(async (manager) => {
      await manager.update(CalendarEventEntity, id, {
        title: input.title,
        notes: input.notes,
        start_at: input.startAt,
        end_at: input.endAt,
        timezone: input.timezone,
        reminder_minutes: input.reminderMinutes,
      });
      await manager.delete(CalendarEventParticipant, { event_id: id });
      await manager.delete(CalendarEventReminder, { event_id: id });
      await manager.insert(
        CalendarEventParticipant,
        participantIds.map((userId) => {
          const previous = existingParticipants.get(userId);
          const isCreator = userId === existing.creator_id;
          return {
            event_id: id,
            user_id: userId,
            participation_status:
              previous?.participation_status ??
              (isCreator ? CalendarParticipationStatus.accepted : CalendarParticipationStatus.invited),
            responded_at: previous?.responded_at ?? (isCreator ? new Date() : null),
          };
        }),
      );
      await manager.insert(
        CalendarEventReminder,
        participantIds.map((userId) => {
          const previous = existingReminders.find(
            (reminder) => reminder.user_id === userId && reminder.remind_at.getTime() === nextRemindAt.getTime(),
          );
          return {
            event_id: id,
            user_id: userId,
            remind_at: nextRemindAt,
            sent_at: previous?.sent_at ?? null,
            processing_at: null,
            attempts: previous?.attempts ?? 0,
          };
        }),
      );
    });

    const event = await this.findOne(id);
    await this.notifyInvitedParticipants(event, invitedParticipantIds);
    return event;
  }

  async accept(id: number, currentUser: AuthenticatedUser): Promise<CalendarEvent> {
    const event = await this.findEntity(id);
    const participation = event.participant_links.find((participant) => participant.user_id === currentUser.id);
    if (!participation) throw new ForbiddenException('Вы не являетесь участником этой встречи.');

    const acceptedAt = new Date();
    const result = await this.participantRepo.update(
      {
        event_id: id,
        user_id: currentUser.id,
        participation_status: CalendarParticipationStatus.invited,
      },
      { participation_status: CalendarParticipationStatus.accepted, responded_at: acceptedAt },
    );

    if (result.affected && currentUser.id !== event.creator_id) {
      await this.notifyParticipationAccepted(event, currentUser);
    }

    return this.findOne(id);
  }

  async remove(id: number, currentUser: AuthenticatedUser): Promise<void> {
    const event = await this.findEntity(id);
    this.assertCanManage(event, currentUser);
    await this.eventRepo.remove(event);
  }

  async findOne(id: number): Promise<CalendarEvent> {
    return this.toContract(await this.findEntity(id));
  }

  private async findEntity(id: number): Promise<CalendarEventEntity> {
    const event = await this.eventRepo.findOne({
      where: { id },
      relations: ['creator', 'participant_links', 'participant_links.user'],
    });
    if (!event) throw new NotFoundException('Встреча не найдена.');
    return event;
  }

  private validateInput(dto: CreateCalendarEventDto) {
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Укажите название встречи.');
    const startAt = new Date(dto.start_at);
    const endAt = new Date(dto.end_at);
    if (endAt <= startAt) throw new BadRequestException('Время окончания должно быть позже времени начала.');
    this.assertTimezone(dto.timezone);
    return {
      title,
      notes: dto.notes?.trim() || null,
      startAt,
      endAt,
      timezone: dto.timezone,
      reminderMinutes: dto.reminder_minutes,
    };
  }

  private assertTimezone(timezone: string): void {
    try {
      new Intl.DateTimeFormat('ru-RU', { timeZone: timezone }).format(new Date());
    } catch {
      throw new BadRequestException('Указан неизвестный часовой пояс.');
    }
  }

  private async validateParticipantIds(ids: number[], creatorId: number): Promise<number[]> {
    const participantIds = [...new Set([...ids, creatorId])];
    const users = await this.userRepo.find({
      where: { id: In(participantIds), role: In([ROLES.admin, ROLES.employee]) },
      select: { id: true },
    });
    if (users.length !== participantIds.length) {
      throw new BadRequestException('Один или несколько участников недоступны.');
    }
    return participantIds;
  }

  private assertCanManage(event: CalendarEventEntity, currentUser: AuthenticatedUser): void {
    if (event.creator_id !== currentUser.id && currentUser.role !== ROLES.admin) {
      throw new ForbiddenException('Редактировать встречу может только автор или администратор.');
    }
  }

  private getReminderDate(startAt: Date, reminderMinutes: number): Date {
    return new Date(startAt.getTime() - reminderMinutes * 60_000);
  }

  private toContract(event: CalendarEventEntity): CalendarEvent {
    return {
      id: event.id,
      title: event.title,
      notes: event.notes,
      start_at: event.start_at.toISOString(),
      end_at: event.end_at.toISOString(),
      timezone: event.timezone,
      reminder_minutes: event.reminder_minutes,
      creator_id: event.creator_id,
      creator: this.toCalendarUser(event.creator),
      participants: event.participant_links.map((participant) => this.toCalendarParticipant(participant)),
      created_at: event.created_at.toISOString(),
      updated_at: event.updated_at.toISOString(),
    };
  }

  private toCalendarUser(user: Users): CalendarUser {
    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      patronymic: user.patronymic,
      email: user.email,
      photo_url: user.photo_url,
    };
  }

  private toCalendarParticipant(participant: CalendarEventParticipant): CalendarParticipant {
    return {
      ...this.toCalendarUser(participant.user),
      participation_status: participant.participation_status,
      responded_at: participant.responded_at?.toISOString() ?? null,
    };
  }

  private async notifyInvitedParticipants(event: CalendarEvent, participantIds: number[]): Promise<void> {
    if (!participantIds.length) return;
    const dateLabel = this.formatEventDate(new Date(event.start_at), event.timezone);
    const creatorName = this.formatUserName(event.creator);

    for (const participantId of participantIds) {
      try {
        await this.notificationsService.createWithEmail(
          {
            recipient_id: participantId,
            name: `Вас пригласили на встречу: ${event.title}`,
            message: `${creatorName}. ${dateLabel}. Подтвердите участие.`,
            link: `/calendar?event-id=${event.id}`,
          },
          this.buildInvitationEmailHtml(event, dateLabel, creatorName),
        );
      } catch (error) {
        this.logger.error(`Не удалось уведомить участника ${participantId} о встрече ${event.id}: ${String(error)}`);
      }
    }
  }

  private async notifyParticipationAccepted(event: CalendarEventEntity, currentUser: AuthenticatedUser): Promise<void> {
    const participantName = this.formatUserName(currentUser);
    const dateLabel = this.formatEventDate(event.start_at, event.timezone);
    const notificationTitle = `${participantName} примет участие`;
    const notificationMessage = `Встреча "${event.title}", ${dateLabel}.`;

    try {
      await this.notificationsService.createWithEmail(
        {
          recipient_id: event.creator_id,
          name: notificationTitle,
          message: notificationMessage,
          link: `/calendar?event-id=${event.id}`,
        },
        `<h2>${this.escapeHtml(notificationTitle)}</h2><p>${this.escapeHtml(notificationMessage)}</p><p><a href="${this.escapeHtml(buildPublicAppUrl(this.configService, `/calendar?event-id=${event.id}`))}">Открыть встречу в Nervion</a></p>`,
      );
    } catch (error) {
      this.logger.error(`Не удалось уведомить автора о подтверждении встречи ${event.id}: ${String(error)}`);
    }
  }

  private buildInvitationEmailHtml(event: CalendarEvent, dateLabel: string, creatorName: string): string {
    const url = buildPublicAppUrl(this.configService, `/calendar?event-id=${event.id}`);
    return `<h2>${this.escapeHtml(event.title)}</h2><p>${this.escapeHtml(creatorName)} пригласил вас на встречу.</p><p><strong>${this.escapeHtml(dateLabel)}</strong></p><p><a href="${this.escapeHtml(url)}">Открыть встречу и подтвердить участие</a></p>`;
  }

  private formatUserName(user: Pick<CalendarUser, 'first_name' | 'last_name' | 'patronymic'>): string {
    return [user.first_name, user.patronymic, user.last_name].filter(Boolean).join(' ');
  }

  private async processDueReminders(): Promise<void> {
    if (this.processingReminders) return;
    this.processingReminders = true;
    try {
      const claimedResult: unknown = await this.dataSource.query(`
        WITH due AS (
          SELECT reminder.id
          FROM calendar_event_reminders reminder
          INNER JOIN calendar_events event ON event.id = reminder.event_id
          WHERE reminder.sent_at IS NULL
            AND reminder.remind_at <= now()
            AND event.end_at > now()
            AND reminder.attempts < 10
            AND (reminder.processing_at IS NULL OR reminder.processing_at < now() - interval '5 minutes')
          ORDER BY reminder.remind_at ASC
          LIMIT 50
          FOR UPDATE SKIP LOCKED
        ), claimed AS (
          UPDATE calendar_event_reminders reminder
          SET processing_at = now(), attempts = reminder.attempts + 1
          FROM due
          WHERE reminder.id = due.id
          RETURNING reminder.id
        )
        SELECT id FROM claimed
      `);

      for (const id of this.getClaimedReminderIds(claimedResult)) await this.deliverReminder(id);
    } catch (error) {
      this.logger.error(`Не удалось обработать напоминания календаря: ${String(error)}`);
    } finally {
      this.processingReminders = false;
    }
  }

  private getClaimedReminderIds(result: unknown): number[] {
    const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
    if (!Array.isArray(rows)) return [];

    return rows.map((row) => Number((row as { id?: unknown })?.id)).filter((id) => Number.isInteger(id) && id > 0);
  }

  private async deliverReminder(id: number): Promise<void> {
    const reminder = await this.reminderRepo.findOne({
      where: { id },
      relations: ['event', 'user'],
    });
    if (!reminder || reminder.sent_at) return;

    try {
      const dateLabel = this.formatEventDate(reminder.event.start_at, reminder.event.timezone);
      const body = `${dateLabel}. ${reminder.event.notes || 'Откройте встречу, чтобы посмотреть детали.'}`;
      await this.notificationsService.createWithEmail(
        {
          recipient_id: reminder.user_id,
          name: `Скоро встреча: ${reminder.event.title}`,
          message: body,
          link: `/calendar?event-id=${reminder.event_id}`,
        },
        this.buildEmailHtml(reminder.event, dateLabel),
      );
      await this.reminderRepo.update(id, { sent_at: new Date(), processing_at: null });
    } catch (error) {
      await this.reminderRepo.update(id, { processing_at: null });
      this.logger.error(`Не удалось отправить напоминание календаря ${id}: ${String(error)}`);
    }
  }

  private formatEventDate(date: Date, timezone: string): string {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  private buildEmailHtml(event: CalendarEventEntity, dateLabel: string): string {
    const title = this.escapeHtml(event.title);
    const notes = event.notes ? `<p>${this.escapeHtml(event.notes).replace(/\n/g, '<br>')}</p>` : '';
    const url = buildPublicAppUrl(this.configService, `/calendar?event-id=${event.id}`);
    return `<h2>${title}</h2><p><strong>${this.escapeHtml(dateLabel)}</strong></p>${notes}<p><a href="${this.escapeHtml(url)}">Открыть встречу в Nervion</a></p>`;
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, (symbol) => {
      const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
      return entities[symbol];
    });
  }
}
