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
  const repo = {
    findOneBy: jest.fn(),
    delete: jest.fn(),
    findBy: jest.fn(),
    find: jest.fn(),
    upsert: jest.fn(),
    query: jest.fn(),
  };
  const configGet = jest.fn<string | undefined, [string]>();
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
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();
    service = module.get(PushService);
  });

  it('does not require VAPID keys or expose a public key when push is disabled', () => {
    configGet.mockImplementation((key) => (key === 'PUSH_ENABLED' ? 'false' : undefined));
    service.onModuleInit();
    expect(webpush.setVapidDetails).not.toHaveBeenCalled();
    expect(service.getVapidPublicKey()).toBe('');
  });

  it('rejects subscription registration and test delivery without network access when disabled', async () => {
    configGet.mockImplementation((key) => (key === 'PUSH_ENABLED' ? 'false' : undefined));
    await expect(
      service.saveSubscription(7, {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.sendTest(7, subscription.endpoint)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(repo.query).not.toHaveBeenCalled();
    expect(repo.findOneBy).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('skips background notifications and subscription reads when disabled', async () => {
    configGet.mockImplementation((key) => (key === 'PUSH_ENABLED' ? 'false' : undefined));
    const payload = { title: 'Test', body: 'Test' };
    await service.sendToUser(7, payload);
    await service.sendToUsers([7, 8], payload);
    expect(repo.findBy).not.toHaveBeenCalled();
    expect(repo.find).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('rechecks disabled state before sending previously loaded subscriptions', async () => {
    repo.findBy.mockImplementation(async () => {
      configGet.mockImplementation((key) => (key === 'PUSH_ENABLED' ? 'false' : undefined));
      return [subscription];
    });
    await service.sendToUser(7, { title: 'Test', body: 'Test' });
    expect(repo.findBy).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
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
