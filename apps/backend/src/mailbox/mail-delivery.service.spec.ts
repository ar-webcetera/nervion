import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MailDeliveryEventType, MailDeliveryStatus } from '@tracker/contracts';
import { MailDeliveryService } from './mail-delivery.service';
import { MailDeliveryEvents } from './entities/mail-delivery-event.entity';
import { MailMessages, MAIL_DIRECTIONS } from './entities/mail-message.entity';
import { MailAccounts } from './entities/mail-account.entity';

describe('MailDeliveryService', () => {
  let service: MailDeliveryService;

  const mockMessagesRepository = {
    findOne: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockEventsRepository = {
    findOne: jest.fn(),
    create: jest.fn((value: Partial<MailDeliveryEvents>) => value),
    save: jest.fn((value: Partial<MailDeliveryEvents>) => Promise.resolve({ id: 1, ...value })),
  };

  const mockAccountsRepository = {
    createQueryBuilder: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailDeliveryService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: getRepositoryToken(MailMessages), useValue: mockMessagesRepository },
        { provide: getRepositoryToken(MailDeliveryEvents), useValue: mockEventsRepository },
        { provide: getRepositoryToken(MailAccounts), useValue: mockAccountsRepository },
      ],
    }).compile();

    service = module.get(MailDeliveryService);
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'POSTBOX_EVENTS_WEBHOOK_SECRET') return 'test-secret';
      return undefined;
    });
  });

  it('отклоняет webhook без секрета', () => {
    expect(() => service.assertWebhookSecret(undefined)).toThrow(UnauthorizedException);
    expect(() => service.assertWebhookSecret('Bearer wrong')).toThrow(UnauthorizedException);
    expect(() => service.assertWebhookSecret('Bearer test-secret')).not.toThrow();
  });

  it('применяет Open к письму по provider_message_id', async () => {
    const message = {
      id: 12,
      delivery_status: MailDeliveryStatus.SENT,
      open_count: 0,
      click_count: 0,
      first_opened_at: null,
      last_delivery_event_at: null,
    } as MailMessages;

    mockMessagesRepository.findOne.mockResolvedValue(message);
    mockEventsRepository.findOne.mockResolvedValue(null);

    const result = await service.ingestPayload({
      eventType: MailDeliveryEventType.OPEN,
      eventId: 'evt-1',
      mail: { messageId: 'QA_abc', timestamp: '2026-08-08T10:00:00+04:00' },
      open: { timestamp: '2026-08-08T10:00:00+04:00', ipAddress: '1.2.3.4' },
    });

    expect(result).toEqual({ accepted: 1, ignored: 0 });
    expect(mockMessagesRepository.findOne).toHaveBeenCalledWith({
      where: { provider_message_id: 'QA_abc', direction: MAIL_DIRECTIONS.outbound },
    });
    expect(mockEventsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: 12,
        event_type: MailDeliveryEventType.OPEN,
        provider_event_id: 'evt-1',
      }),
    );
    expect(mockMessagesRepository.update).toHaveBeenCalledWith(
      { id: 12 },
      expect.objectContaining({
        open_count: 1,
        delivery_status: MailDeliveryStatus.DELIVERED,
      }),
    );
  });

  it('принимает пакет messages[] от Cloud Functions trigger', async () => {
    mockMessagesRepository.findOne.mockResolvedValue({
      id: 12,
      delivery_status: MailDeliveryStatus.SENT,
      open_count: 0,
      click_count: 0,
      first_opened_at: null,
      last_delivery_event_at: null,
    });
    mockEventsRepository.findOne.mockResolvedValue(null);

    const result = await service.ingestPayload({
      messages: [
        {
          eventType: MailDeliveryEventType.DELIVERY,
          eventId: 'evt-delivery-1',
          mail: { messageId: 'QA_abc', timestamp: '2026-08-08T10:00:00+04:00' },
          delivery: { timestamp: '2026-08-08T10:00:00+04:00' },
        },
      ],
    });

    expect(result).toEqual({ accepted: 1, ignored: 0 });
    expect(mockMessagesRepository.update).toHaveBeenCalledWith(
      { id: 12 },
      expect.objectContaining({
        delivery_status: MailDeliveryStatus.DELIVERED,
      }),
    );
  });

  it('в сводке треда берёт доставку, открытия и клики последнего отправленного письма', async () => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          thread_id: '2830',
          delivery_status: MailDeliveryStatus.SENT,
          open_count: '1',
          click_count: '2',
        },
      ]),
    };
    mockMessagesRepository.createQueryBuilder.mockReturnValue(qb);

    const map = await service.attachDeliverySummaries([2830]);

    expect(map.get(2830)).toEqual({
      delivery_status: MailDeliveryStatus.SENT,
      open_count: 1,
      click_count: 2,
    });
    expect(qb.addSelect).toHaveBeenCalledWith(
      '(ARRAY_AGG(message.delivery_status ORDER BY message.created_at DESC, message.id DESC))[1]',
      'delivery_status',
    );
    expect(qb.addSelect).toHaveBeenCalledWith(
      '(ARRAY_AGG(message.open_count ORDER BY message.created_at DESC, message.id DESC))[1]',
      'open_count',
    );
    expect(qb.addSelect).toHaveBeenCalledWith(
      '(ARRAY_AGG(message.click_count ORDER BY message.created_at DESC, message.id DESC))[1]',
      'click_count',
    );
    expect(qb.groupBy).toHaveBeenCalledWith('message.thread_id');
  });

  it('игнорирует дубль по eventId', async () => {
    mockMessagesRepository.findOne.mockResolvedValue({
      id: 12,
      delivery_status: MailDeliveryStatus.DELIVERED,
      open_count: 1,
    });
    mockEventsRepository.findOne.mockResolvedValue({ id: 99 });

    const result = await service.ingestPayload({
      eventType: MailDeliveryEventType.OPEN,
      eventId: 'evt-1',
      mail: { messageId: 'QA_abc' },
      open: {},
    });

    expect(result).toEqual({ accepted: 0, ignored: 1 });
    expect(mockEventsRepository.save).not.toHaveBeenCalled();
  });
});
