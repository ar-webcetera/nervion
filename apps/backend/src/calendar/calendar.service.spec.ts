import { CalendarService } from './calendar.service';

describe('CalendarService', () => {
  it('notifies a newly assigned participant when a meeting is created', async () => {
    const creator = {
      id: 3,
      first_name: 'Иван',
      last_name: 'Петров',
      patronymic: null,
      email: 'ivan@example.com',
      photo_url: null,
    };
    const participant = {
      id: 8,
      first_name: 'Анна',
      last_name: 'Смирнова',
      patronymic: null,
      email: 'anna@example.com',
      photo_url: null,
    };
    const savedEvent = {
      id: 17,
      title: 'Планерка',
      notes: null,
      start_at: new Date('2026-10-20T08:00:00.000Z'),
      end_at: new Date('2026-10-20T09:00:00.000Z'),
      timezone: 'Europe/Samara',
      reminder_minutes: 15,
      creator_id: creator.id,
      creator,
      participant_links: [
        {
          event_id: 17,
          user_id: creator.id,
          participation_status: 'accepted',
          responded_at: new Date('2026-10-19T08:00:00.000Z'),
          user: creator,
        },
        {
          event_id: 17,
          user_id: participant.id,
          participation_status: 'invited',
          responded_at: null,
          user: participant,
        },
      ],
      created_at: new Date('2026-10-19T08:00:00.000Z'),
      updated_at: new Date('2026-10-19T08:00:00.000Z'),
    };
    const manager = {
      create: jest.fn().mockReturnValue({}),
      save: jest.fn().mockResolvedValue({ id: 17 }),
      insert: jest.fn().mockResolvedValue({}),
    };
    const dataSource = {
      transaction: jest.fn((callback: (entityManager: typeof manager) => Promise<number>) => callback(manager)),
    };
    const notificationsService = { createWithEmail: jest.fn().mockResolvedValue({ id: 51 }) };
    const service = new CalendarService(
      { findOne: jest.fn().mockResolvedValue(savedEvent) } as never,
      {} as never,
      {} as never,
      { find: jest.fn().mockResolvedValue([{ id: creator.id }, { id: participant.id }]) } as never,
      dataSource as never,
      notificationsService as never,
      { get: jest.fn().mockReturnValue('localhost:3000') } as never,
    );

    await service.create(
      {
        title: 'Планерка',
        notes: null,
        start_at: '2026-10-20T08:00:00.000Z',
        end_at: '2026-10-20T09:00:00.000Z',
        timezone: 'Europe/Samara',
        reminder_minutes: 15,
        participant_ids: [participant.id],
      },
      creator as never,
    );

    expect(manager.insert).toHaveBeenCalledWith(
      expect.any(Function),
      expect.arrayContaining([
        expect.objectContaining({ user_id: creator.id, participation_status: 'accepted' }),
        expect.objectContaining({ user_id: participant.id, participation_status: 'invited' }),
      ]),
    );
    expect(notificationsService.createWithEmail).toHaveBeenCalledTimes(1);
    expect(notificationsService.createWithEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient_id: participant.id,
        name: 'Вас пригласили на встречу: Планерка',
        link: '/calendar?event-id=17',
      }),
      expect.stringContaining('подтвердить участие'),
    );
  });

  it('marks a claimed reminder as sent when the database returns a structured update result', async () => {
    const eventRepo = {};
    const updateReminder = jest
      .fn<Promise<{ affected: number }>, [number, { sent_at?: Date; processing_at: Date | null }]>()
      .mockResolvedValue({ affected: 1 });
    const reminderRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 17,
        event_id: 3,
        user_id: 8,
        sent_at: null,
        event: {
          id: 3,
          title: 'Планерка',
          notes: null,
          start_at: new Date('2026-10-19T12:00:00.000Z'),
          timezone: 'Europe/Samara',
        },
        user: { id: 8 },
      }),
      update: updateReminder,
    };
    const notificationsService = {
      createWithEmail: jest.fn().mockResolvedValue({ id: 41 }),
    };
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([[{ id: 17 }], 1])
        .mockResolvedValueOnce([]),
    };
    const service = new CalendarService(
      eventRepo as never,
      reminderRepo as never,
      {} as never,
      {} as never,
      dataSource as never,
      notificationsService as never,
      { get: jest.fn().mockReturnValue('localhost:3000') } as never,
    );
    const processDueReminders = () => (service as unknown as { processDueReminders: () => Promise<void> }).processDueReminders();

    await processDueReminders();
    await processDueReminders();

    expect(notificationsService.createWithEmail).toHaveBeenCalledTimes(1);
    expect(reminderRepo.findOne).toHaveBeenCalledWith({ where: { id: 17 }, relations: ['event', 'user'] });
    expect(updateReminder).toHaveBeenCalledTimes(1);
    const [reminderId, update] = updateReminder.mock.calls[0];
    expect(reminderId).toBe(17);
    expect(update.sent_at).toBeInstanceOf(Date);
    expect(update.processing_at).toBeNull();
  });

  it('accepts an invitation once and notifies the meeting creator', async () => {
    const participant = {
      id: 8,
      first_name: 'Анна',
      last_name: 'Смирнова',
      patronymic: null,
      email: 'anna@example.com',
      photo_url: null,
    };
    const creator = {
      id: 3,
      first_name: 'Иван',
      last_name: 'Петров',
      patronymic: null,
      email: 'ivan@example.com',
      photo_url: null,
    };
    const event = {
      id: 17,
      title: 'Планерка',
      notes: null,
      start_at: new Date('2026-10-20T08:00:00.000Z'),
      end_at: new Date('2026-10-20T09:00:00.000Z'),
      timezone: 'Europe/Samara',
      reminder_minutes: 15,
      creator_id: creator.id,
      creator,
      participant_links: [
        {
          event_id: 17,
          user_id: participant.id,
          participation_status: 'invited',
          responded_at: null,
          user: participant,
        },
      ],
      created_at: new Date('2026-10-19T08:00:00.000Z'),
      updated_at: new Date('2026-10-19T08:00:00.000Z'),
    };
    const acceptedEvent = {
      ...event,
      participant_links: [
        {
          ...event.participant_links[0],
          participation_status: 'accepted',
          responded_at: new Date('2026-10-19T09:00:00.000Z'),
        },
      ],
    };
    const eventRepo = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(event)
        .mockResolvedValueOnce(acceptedEvent)
        .mockResolvedValueOnce(acceptedEvent)
        .mockResolvedValueOnce(acceptedEvent),
    };
    const updateParticipation = jest
      .fn<
        Promise<{ affected: number }>,
        [
          { event_id: number; user_id: number; participation_status: string },
          { participation_status: string; responded_at: Date },
        ]
      >()
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 });
    const participantRepo = { update: updateParticipation };
    const notificationsService = { createWithEmail: jest.fn().mockResolvedValue({ id: 91 }) };
    const service = new CalendarService(
      eventRepo as never,
      {} as never,
      participantRepo as never,
      {} as never,
      {} as never,
      notificationsService as never,
      { get: jest.fn().mockReturnValue('localhost:3000') } as never,
    );

    const result = await service.accept(17, participant as never);
    await service.accept(17, participant as never);

    const [criteria, update] = updateParticipation.mock.calls[0];
    expect(criteria).toEqual({ event_id: 17, user_id: participant.id, participation_status: 'invited' });
    expect(update.participation_status).toBe('accepted');
    expect(update.responded_at).toBeInstanceOf(Date);
    expect(notificationsService.createWithEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient_id: creator.id,
        name: 'Анна Смирнова примет участие',
        link: '/calendar?event-id=17',
      }),
      expect.stringContaining('Открыть встречу в Nervion'),
    );
    expect(notificationsService.createWithEmail).toHaveBeenCalledTimes(1);
    expect(result.participants[0]?.participation_status).toBe('accepted');
  });
});
