import { createHmac } from 'node:crypto';
import type { Socket } from 'socket.io';
import type { DataSource } from 'typeorm';
import { TenantStatus } from '@tracker/contracts';
import { JwtAuthService } from '../auth/jwt.service';
import { PlatformService } from '../platform/platform.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { TenantSocketService } from './tenant-socket.service';

describe('connected socket tenant host', () => {
  const previous = { TENANCY_ENABLED: process.env.TENANCY_ENABLED, TENANCY_PROXY_SECRET: process.env.TENANCY_PROXY_SECRET };
  const tenant = {
    id: 'a',
    slug: 'a',
    hostname: 'a.example.test',
    status: TenantStatus.ACTIVE,
    databaseShardId: 'data_1',
    readOnly: false,
    featureFlags: {},
    storageNamespace: 'tenants/a',
  };
  const platform = { resolveTenant: jest.fn(), assertSession: jest.fn() };
  const database = { run: (_tenant: object, work: () => Promise<object>) => work() };
  const db = { getRepository: () => ({ findOneBy: async () => ({ id: 1, role: 'admin' }) }) };
  const jwt = { verifyToken: jest.fn(() => ({ id: 1 })) };
  let service: TenantSocketService;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    process.env.TENANCY_ENABLED = 'true';
    process.env.TENANCY_PROXY_SECRET = 'unit-test-proxy-secret-at-least-32-characters';
    platform.resolveTenant.mockResolvedValue(tenant);
    platform.assertSession.mockResolvedValue({ role: 'admin' });
    service = new TenantSocketService(
      jwt as object as JwtAuthService,
      platform as object as PlatformService,
      database as object as TenantDatabaseService,
      new TenantContextService(),
      db as object as DataSource,
    );
  });
  afterEach(() => jest.useRealTimers());
  afterAll(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const client = () => {
    const timestamp = String(Date.now());
    return {
      data: {},
      join: jest.fn(),
      handshake: {
        headers: {
          host: 'internal-backend',
          origin: 'https://a.example.test',
          cookie: 'authToken=test',
          'x-nervion-host': tenant.hostname,
          'x-nervion-timestamp': timestamp,
          'x-nervion-signature': createHmac('sha256', process.env.TENANCY_PROXY_SECRET!)
            .update(`${timestamp}\n${tenant.hostname}`)
            .digest('hex'),
        },
      },
    } as object as Socket;
  };

  it('pins the verified hostname but rechecks membership after the ingress signature expires', async () => {
    const socket = client();
    await service.connect(socket);
    expect(socket.data.nervionHostname).toBe(tenant.hostname);
    jest.advanceTimersByTime(70_000);
    await expect(service.authenticate(socket.handshake)).rejects.toThrow('подпись');
    await expect(service.authenticateConnected(socket)).resolves.toEqual({ tenantId: 'a', userId: 1, role: 'admin' });
    platform.assertSession.mockRejectedValueOnce(new Error('Membership revoked'));
    await expect(service.authenticateConnected(socket)).rejects.toThrow('Membership revoked');
  });

  it('does not create trusted connection data from a forged proxy header', async () => {
    const socket = client();
    socket.handshake.headers['x-nervion-signature'] = '0'.repeat(64);
    await expect(service.connect(socket)).rejects.toThrow();
    expect(socket.data.nervionHostname).toBeUndefined();
    expect(socket.join).not.toHaveBeenCalled();
    await expect(service.authenticateConnected(socket)).rejects.toThrow();
  });
});
