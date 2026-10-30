import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { TenantStatus, type TenantDescriptor } from '@tracker/contracts';
import { PlatformService } from '../platform/platform.service';
import { TenantContextService } from './tenant-context.service';
import { TenantDatabaseService } from './tenant-database.service';
import { TenantMiddleware } from './tenant.middleware';

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  destroyed = false;
  sent = false;
  setHeader = jest.fn();
  vary = jest.fn();
  destroy = jest.fn(() => {
    this.destroyed = true;
  });
  end = jest.fn(() => {
    this.sent = true;
    return this;
  });
}

describe('Tenant HTTP boundary', () => {
  const previousEnabled = process.env.TENANCY_ENABLED;
  const previousAdmin = process.env.PLATFORM_ADMIN_HOST;
  const tenant: TenantDescriptor = {
    id: 'a',
    slug: 'a',
    hostname: 'a.nervion.ru',
    status: TenantStatus.ACTIVE,
    databaseShardId: 'data_1',
    readOnly: false,
    featureFlags: {},
    storageNamespace: 'tenants/a',
  };
  let lifecycle: string[];
  let selected: TenantDescriptor;
  let middleware: TenantMiddleware;
  beforeEach(() => {
    process.env.TENANCY_ENABLED = 'true';
    delete process.env.PLATFORM_ADMIN_HOST;
    selected = { ...tenant, featureFlags: {} };
    lifecycle = [];
    const database = {
      run: async <T>(_tenant: TenantDescriptor, callback: () => Promise<T>): Promise<T> => {
        try {
          const result = await callback();
          lifecycle.push('commit');
          return result;
        } catch (error) {
          lifecycle.push('rollback');
          throw error;
        } finally {
          lifecycle.push('release');
        }
      },
    } as TenantDatabaseService;
    const platform = { resolveTenant: jest.fn(() => Promise.resolve(selected)) } as object as PlatformService;
    middleware = new TenantMiddleware(new TenantContextService(), database, platform);
  });
  afterAll(() => {
    for (const [key, value] of Object.entries({ TENANCY_ENABLED: previousEnabled, PLATFORM_ADMIN_HOST: previousAdmin })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const request = (path = '/api/tasks', method = 'GET', host = 'a.nervion.ru') =>
    ({
      originalUrl: path,
      method,
      headers: { host },
    }) as Request;

  it('sends response only after transaction commit and connection release', async () => {
    const response = new FakeResponse();
    const end = response.end;
    const next: NextFunction = () => {
      (response as object as Response).end('ok');
      expect(response.sent).toBe(false);
      expect(lifecycle).toEqual([]);
    };
    await middleware.use(request(), response as object as Response, next);
    expect(lifecycle).toEqual(['commit', 'release']);
    expect(end).toHaveBeenCalledWith('ok');
    expect(response.sent).toBe(true);
  });

  it('rolls back error responses before sending them', async () => {
    const response = new FakeResponse();
    await middleware.use(request(), response as object as Response, () => {
      response.statusCode = 403;
      (response as object as Response).end('forbidden');
    });
    expect(lifecycle).toEqual(['rollback', 'release']);
    expect(response.sent).toBe(true);
  });

  it('rolls back an interrupted request and does not send a response', async () => {
    const response = new FakeResponse();
    await middleware.use(request(), response as object as Response, () => {
      response.destroyed = true;
      response.emit('close');
    });
    expect(lifecycle).toEqual(['rollback', 'release']);
    expect(response.sent).toBe(false);
  });

  it('enforces feature flags and read-only before invoking handlers', async () => {
    const next = jest.fn();
    selected.featureFlags.tasks = false;
    await expect(middleware.use(request(), new FakeResponse() as object as Response, next)).rejects.toThrow('Функция отключена');
    selected.featureFlags.tasks = true;
    selected.readOnly = true;
    await expect(middleware.use(request('/api/tasks', 'POST'), new FakeResponse() as object as Response, next)).rejects.toThrow(
      'только для чтения',
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('allows the default admin hostname only for platform routes', async () => {
    const next = jest.fn();
    await middleware.use(
      request('/api/platform/tenants', 'GET', 'admin.nervion.ru'),
      new FakeResponse() as object as Response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    await expect(
      middleware.use(request('/api/platform/tenants'), new FakeResponse() as object as Response, next),
    ).rejects.toThrow();
  });

  it.each(['git', 'mailbox', 'voice', 'healthchecks'])('opens %s only after explicit tenant opt-in', async (route) => {
    const feature = route === 'mailbox' ? 'mail' : route;
    const next = jest.fn();
    await expect(middleware.use(request(`/api/${route}`), new FakeResponse() as object as Response, next)).rejects.toThrow(
      'Функция отключена',
    );
    expect(next).not.toHaveBeenCalled();
    selected.featureFlags[feature] = true;
    const response = new FakeResponse();
    await middleware.use(request(`/api/${route}`), response as object as Response, () => response.end());
    expect(lifecycle).toEqual(['commit', 'release']);
  });

  const callback = '/api/mailbox/postbox-events/11111111-1111-4111-8111-111111111111';
  it('dispatches a machine-only callback on admin host without a business transaction', async () => {
    const next = jest.fn();
    await middleware.use(request(callback, 'POST', 'admin.nervion.ru'), new FakeResponse() as object as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual([]);
  });

  it.each([
    [callback, 'POST', 'a.nervion.ru', undefined],
    [callback, 'GET', 'admin.nervion.ru', undefined],
    [callback, 'POST', 'admin.nervion.ru', 'https://admin.nervion.ru'],
    ['/api/mailbox/postbox-events', 'POST', 'admin.nervion.ru', undefined],
    ['/api/mailbox/postbox-events/not-a-uuid', 'POST', 'admin.nervion.ru', undefined],
  ])('rejects an invalid callback boundary %s %s %s %s', async (path, method, host, origin) => {
    const req = request(path, method, host);
    req.headers.origin = origin;
    const next = jest.fn();
    await expect(middleware.use(req, new FakeResponse() as object as Response, next)).rejects.toThrow();
    expect(next).not.toHaveBeenCalled();
    expect(lifecycle).toEqual([]);
  });
});
