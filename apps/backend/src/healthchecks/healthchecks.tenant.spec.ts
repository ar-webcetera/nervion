import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import * as https from 'https';
import { Repository, EntityManager } from 'typeorm';
import { TenantDescriptor, TenantStatus } from '@tracker/contracts';
import { ChatsService } from '../chats/chats.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { TenantJobsService, TenantJob } from '../tenancy/tenant-jobs.service';
import { resolvePublicEndpoint } from '../common/network/public-endpoint';
import { HealthchecksService } from './healthchecks.service';
import { HealthCheck } from './entities/healthcheck.entity';

jest.mock('../common/network/public-endpoint', () => ({
  ...jest.requireActual<typeof import('../common/network/public-endpoint')>('../common/network/public-endpoint'),
  resolvePublicEndpoint: jest.fn(),
}));

describe('tenant monitoring', () => {
  const environment = {
    TENANCY_ENABLED: process.env.TENANCY_ENABLED,
    HEALTHCHECK_ALLOWED_HOSTS: process.env.HEALTHCHECK_ALLOWED_HOSTS,
  };
  const tenant: TenantDescriptor = {
    id: 'tenant-a',
    slug: 'a',
    hostname: 'a.example.test',
    status: TenantStatus.ACTIVE,
    databaseShardId: 'data_1',
    readOnly: false,
    featureFlags: { healthchecks: true },
    storageNamespace: 'tenants/tenant-a',
  };
  const context = new TenantContextService();
  const repository = {
    find: jest.fn(),
    findBy: jest.fn(),
    findOneBy: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };
  const membership = { findOneBy: jest.fn() };
  const manager = { query: jest.fn(), getRepository: jest.fn(() => membership) };
  const jobs = {
    register: jest.fn<void, [string, (job: TenantJob) => Promise<void>]>(),
    schedule: jest.fn<void, [string, () => Promise<void>]>(),
    enqueue: jest.fn(),
  };
  const service = new HealthchecksService(
    repository as object as Repository<HealthCheck>,
    {} as ChatsService,
    context,
    jobs as object as TenantJobsService,
  );
  const run = <T>(work: () => T, change: Partial<TenantDescriptor> = {}): T =>
    context.run(
      {
        tenant: { ...tenant, ...change },
        manager: manager as object as EntityManager,
        active: true,
        actorId: 2,
        afterCommit: [],
        afterRollback: [],
        pending: new Set(),
      },
      work,
    );
  const dto = {
    name: 'API',
    url: 'https://example.com/health',
    interval_seconds: 60,
    chat_id: '11111111-1111-4111-8111-111111111111',
    sender_user_id: 1,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.TENANCY_ENABLED = 'true';
    process.env.HEALTHCHECK_ALLOWED_HOSTS = 'example.com';
    manager.getRepository.mockReturnValue(membership);
    manager.query.mockResolvedValue([]);
    repository.count.mockResolvedValue(0);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('registers durable work without enumerating global records or creating process timers', async () => {
    await service.onModuleInit();
    expect(jobs.register).toHaveBeenCalledWith('healthchecks.probe', expect.any(Function));
    expect(jobs.schedule).toHaveBeenCalledWith('healthchecks.probe', expect.any(Function));
    expect(repository.findBy).not.toHaveBeenCalled();
  });

  it('rejects missing context, disabled feature and read-only mutations', async () => {
    await expect(service.findAll()).rejects.toThrow('Контекст пространства');
    await expect(run(() => service.findAll(), { featureFlags: {} })).rejects.toThrow('отключен');
    await expect(run(() => service.create(dto), { readOnly: true })).rejects.toThrow('только для чтения');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('locks the tenant quota before counting and does not save past the limit', async () => {
    repository.count.mockResolvedValue(100);
    await expect(run(() => service.create(dto))).rejects.toThrow('лимит');
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), ['tenant-a:healthchecks']);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects unavailable chat/sender and unapproved targets', async () => {
    membership.findOneBy.mockResolvedValue(null);
    await expect(run(() => service.create(dto))).rejects.toThrow('Чат и отправитель');
    await expect(run(() => service.create({ ...dto, url: 'http://127.0.0.1/' }))).rejects.toThrow();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('preserves existing thirty-second monitors when editing and toggling', async () => {
    const monitor = { ...dto, id: 1, timeout_seconds: 30, is_active: true };
    membership.findOneBy.mockResolvedValue({ id: 1 });
    repository.findOneBy.mockResolvedValue(monitor);
    repository.save.mockImplementation((value: HealthCheck) => Promise.resolve(value));
    await expect(run(() => service.update(1, { name: 'Renamed API' }))).resolves.toMatchObject({ timeout_seconds: 30 });
    await expect(run(() => service.toggle(1))).resolves.toMatchObject({ timeout_seconds: 30, is_active: false });
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it('accepts thirty seconds and rejects larger values before saving in either mode', async () => {
    membership.findOneBy.mockResolvedValue({ id: 1 });
    repository.create.mockImplementation((value: Partial<HealthCheck>) => ({ ...value, is_active: false }));
    repository.save.mockImplementation((value: HealthCheck) => Promise.resolve(value));
    for (const enabled of ['true', 'false']) {
      process.env.TENANCY_ENABLED = enabled;
      await expect(run(() => service.create({ ...dto, timeout_seconds: 30 }))).resolves.toMatchObject({ timeout_seconds: 30 });
      await expect(run(() => service.create({ ...dto, timeout_seconds: 31 }))).rejects.toThrow('от 1 до 30');
    }
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it('runs configured thirty-second probes without shortening their deadline', async () => {
    const probe = service as object as {
      httpGet: (url: string, timeout: number) => Promise<number>;
      publicHttpGet: (url: string, timeout: number) => Promise<number>;
    };
    const request = jest.spyOn(probe, 'publicHttpGet').mockResolvedValue(200);
    await expect(run(() => probe.httpGet(dto.url, 30))).resolves.toBe(200);
    expect(request).toHaveBeenLastCalledWith(dto.url, 30);
    await expect(run(() => probe.httpGet(dto.url, 31))).resolves.toBe(200);
    expect(request).toHaveBeenLastCalledWith(dto.url, 30);
  });

  it('aborts a stalled probe at the thirty-second absolute deadline', async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(resolvePublicEndpoint).mockResolvedValue({ url: new URL(dto.url), address: '93.184.216.34', family: 4 });
      const request = new EventEmitter() as ClientRequest;
      request.end = jest.fn(() => request) as ClientRequest['end'];
      const destroy = jest.fn((error?: Error) => {
        request.emit('error', error);
        return request;
      });
      request.destroy = destroy;
      jest.spyOn(https, 'request').mockReturnValue(request);
      const probe = service as object as { httpGet: (url: string, timeout: number) => Promise<number> };
      const pending = run(() => probe.httpGet(dto.url, 30));
      const rejected = expect(pending).rejects.toThrow('Таймаут 30с');
      await jest.advanceTimersByTimeAsync(29_999);
      expect(destroy).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await rejected;
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not schedule or probe tenants with a disabled feature', async () => {
    await service.onModuleInit();
    const schedule = jobs.schedule.mock.calls[0][1];
    const handler = jobs.register.mock.calls[0][1];
    await run(schedule, { featureFlags: {} });
    await run(
      () =>
        handler({
          id: 'probe',
          tenant_id: tenant.id,
          database_shard_id: tenant.databaseShardId,
          actor_id: null,
          idempotency_key: 'probe:1',
          kind: 'healthchecks.probe',
          payload: { id: 1 },
          attempts: 0,
        }),
      { readOnly: true },
    );
    expect(manager.query).not.toHaveBeenCalled();
    expect(resolvePublicEndpoint).not.toHaveBeenCalled();
  });

  it('pins the validated IP, retains TLS hostname and does not follow redirects or download bodies', async () => {
    jest.mocked(resolvePublicEndpoint).mockResolvedValue({ url: new URL(dto.url), address: '93.184.216.34', family: 4 });
    const destroyResponse = jest.fn();
    const response = { statusCode: 302, destroy: destroyResponse } as object as IncomingMessage;
    const request = new EventEmitter() as ClientRequest;
    request.destroy = jest.fn(() => request);
    const spy = jest.spyOn(https, 'request').mockImplementation(((
      options: https.RequestOptions,
      callback: (res: IncomingMessage) => void,
    ) => {
      request.end = jest.fn(() => {
        callback(response);
        return request;
      }) as ClientRequest['end'];
      return request;
    }) as typeof https.request);
    const probe = service as object as { publicHttpGet: (url: string, timeout: number) => Promise<number> };
    await expect(run(() => probe.publicHttpGet(dto.url, 10))).resolves.toBe(302);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: '93.184.216.34',
        servername: 'example.com',
        rejectUnauthorized: true,
        path: '/health',
        agent: false,
        headers: { Host: 'example.com', 'User-Agent': 'Nervion-Monitor/1', Connection: 'close' },
      }),
      expect.any(Function),
    );
    expect(destroyResponse).toHaveBeenCalledTimes(1);
  });
});
