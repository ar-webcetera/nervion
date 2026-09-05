import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as Sentry from '@sentry/nestjs';
import { MailDeliveryMonitorService } from './mail-delivery-monitor.service';
import { MailMessages, MAIL_DIRECTIONS, MAIL_MESSAGE_STATUSES } from './entities/mail-message.entity';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn() }));

describe('MailDeliveryMonitorService', () => {
  const count = jest.fn<Promise<number>, []>();
  let service: MailDeliveryMonitorService;
  let enabled: boolean;
  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-05T12:00:00Z'));
    jest.clearAllMocks();
    enabled = true;
    count.mockResolvedValue(0);
    const module = await Test.createTestingModule({
      providers: [
        MailDeliveryMonitorService,
        { provide: getRepositoryToken(MailMessages), useValue: { count } },
        { provide: ConfigService, useValue: { get: () => (enabled ? 'configured' : undefined) } },
      ],
    }).compile();
    service = module.get(MailDeliveryMonitorService);
  });
  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('не тревожит без писем без событий и проверяет только отправленные через провайдера', async () => {
    await service.check();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        direction: MAIL_DIRECTIONS.outbound,
        status: MAIL_MESSAGE_STATUSES.sent,
        createdAt: expect.objectContaining({ _value: [new Date('2026-09-04T12:00:00Z'), new Date('2026-09-05T11:45:00Z')] }),
        last_delivery_event_at: expect.objectContaining({ _type: 'isNull' }),
        provider_message_id: expect.objectContaining({ _type: 'not' }),
      }),
    });
  });
  it('сообщает о сбое, ограничивает повторы и снова тревожит после восстановления', async () => {
    count.mockResolvedValue(3);
    await service.check();
    await service.check();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        fingerprint: ['mail-delivery-events-missing'],
        extra: { affected_messages: 3, grace_minutes: 15, lookback_hours: 24 },
      }),
    );
    jest.advanceTimersByTime(60 * 60_000);
    await service.check();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
    count.mockResolvedValue(0);
    await service.check();
    count.mockResolvedValue(1);
    await service.check();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(3);
  });
  it('сообщает о сбое проверки без утечки текста ошибки', async () => {
    count.mockRejectedValue(new Error('private connection data'));
    await service.check();
    await service.check();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Не удалось проверить поступление событий Postbox',
      expect.objectContaining({ fingerprint: ['mail-delivery-monitor-failed'] }),
    );
  });
  it('не выполняет параллельные проверки', async () => {
    let complete: (count: number) => void = () => {};
    count.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          complete = resolve;
        }),
    );
    const first = service.check();
    await service.check();
    expect(count).toHaveBeenCalledTimes(1);
    complete(0);
    await first;
  });
  it('не запускает таймер без настроенного мониторинга', () => {
    enabled = false;
    service.onModuleInit();
    expect(jest.getTimerCount()).toBe(0);
    expect(count).not.toHaveBeenCalled();
  });
  it('запускается сразу и каждые пять минут, очищает таймер', async () => {
    service.onModuleInit();
    await Promise.resolve();
    expect(count).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(count).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });
});
