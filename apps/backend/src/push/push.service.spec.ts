import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { GoneException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as webpush from 'web-push';
import { PushService } from './push.service';
import { PushSubscription } from './entities/push-subscription.entity';

jest.mock('web-push', () => ({ sendNotification: jest.fn(), setVapidDetails: jest.fn() }));

describe('PushService test notification', () => {
  let service: PushService;
  const repo = { findOneBy: jest.fn(), delete: jest.fn() };
  const subscription = { user_id: 7, endpoint: 'https://push.example/device', p256dh: 'key', auth: 'auth' };
  const send = jest.mocked(webpush.sendNotification);

  beforeEach(async () => {
    jest.resetAllMocks();
    repo.findOneBy.mockResolvedValue(subscription);
    repo.delete.mockResolvedValue({ affected: 1 });
    send.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const module = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: getRepositoryToken(PushSubscription), useValue: repo },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();
    service = module.get(PushService);
  });

  it('sends only to the requested subscription owned by the authenticated user', async () => {
    await service.sendTest(7, subscription.endpoint);
    expect(repo.findOneBy).toHaveBeenCalledWith({ user_id: 7, endpoint: subscription.endpoint });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      { endpoint: subscription.endpoint, keys: { p256dh: 'key', auth: 'auth' } },
      expect.stringContaining('push-test'),
      { timeout: 10000 },
    );
  });

  it('does not send to another user or an arbitrary endpoint', async () => {
    repo.findOneBy.mockResolvedValue(null);
    await expect(service.sendTest(8, subscription.endpoint)).rejects.toBeInstanceOf(NotFoundException);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([404, 410])('removes an expired subscription on %s and reports failure', async (statusCode) => {
    send.mockRejectedValue({ statusCode });
    await expect(service.sendTest(7, subscription.endpoint)).rejects.toBeInstanceOf(GoneException);
    expect(repo.delete).toHaveBeenCalledWith({ endpoint: subscription.endpoint });
  });

  it('reports provider errors rather than claiming successful delivery', async () => {
    send.mockRejectedValue({ statusCode: 503 });
    await expect(service.sendTest(7, subscription.endpoint)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
