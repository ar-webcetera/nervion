import { DataSource } from 'typeorm';
import { Server } from 'socket.io';
import { TenantStatus, type TenantDescriptor } from '@tracker/contracts';
import { WebsocketGateway } from './websocket.gateway';
import { JwtAuthService } from '../auth/jwt.service';
import { TenantContextService, type TenantExecutionContext } from '../tenancy/tenant-context.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PlatformService } from '../platform/platform.service';
import { TenantSocketService } from './tenant-socket.service';
import { Notifications } from '../notifications/entities/notification.entity';

describe('socket tenant and audience isolation', () => {
  const previous = process.env.TENANCY_ENABLED;
  afterEach(() => {
    if (previous === undefined) delete process.env.TENANCY_ENABLED;
    else process.env.TENANCY_ENABLED = previous;
  });

  it('checks signed cookies and current role, never handshake user_id', async () => {
    delete process.env.TENANCY_ENABLED;
    const makeClient = (cookie?: string) => ({
      handshake: { headers: cookie ? { cookie } : {}, auth: { user_id: '1' } },
      emit: jest.fn(),
      disconnect: jest.fn(),
    });
    const admin = makeClient('authToken=valid-admin');
    const employee = makeClient('authToken=valid-employee');
    const forged = makeClient('authToken=forged');
    const anonymous = makeClient();
    const findOneBy = jest.fn(({ id }: { id: number }) => Promise.resolve({ id, role: id === 1 ? 'admin' : 'employee' }));
    const source = Object.assign(new DataSource({ type: 'postgres' }), { getRepository: () => ({ findOneBy }) });
    const jwt = {
      verifyToken: (token: string) => {
        if (token === 'valid-admin') return { id: 1 };
        if (token === 'valid-employee') return { id: 2 };
        throw new Error('Invalid signature');
      },
    } as JwtAuthService;
    const context = new TenantContextService();
    const platform = {} as PlatformService;
    const database = new TenantDatabaseService(context);
    const sockets = new TenantSocketService(jwt, platform, database, context, source);
    const gateway = new WebsocketGateway(source, context, database, platform, sockets);
    gateway.server = Object.assign(new Server(), {
      in: () => ({ fetchSockets: () => Promise.resolve([admin, employee, forged, anonymous]) }),
    });
    await gateway.sendCrmChanged();
    expect(admin.emit).toHaveBeenCalledWith('crm:changed', undefined);
    expect(employee.emit).not.toHaveBeenCalled();
    expect(forged.emit).not.toHaveBeenCalled();
    expect(anonymous.emit).not.toHaveBeenCalled();
    findOneBy.mockImplementation(({ id }) => Promise.resolve({ id, role: 'employee' }));
    admin.emit.mockClear();
    await gateway.sendCrmChanged();
    expect(admin.emit).not.toHaveBeenCalled();
  });

  it('queues events until commit and filters same numeric user id in another tenant', async () => {
    process.env.TENANCY_ENABLED = 'true';
    const context = new TenantContextService();
    const source = new DataSource({ type: 'postgres' });
    const tenant: TenantDescriptor = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      slug: 'a',
      hostname: 'a.nervion.ru',
      databaseShardId: 'data_1',
      readOnly: false,
      status: TenantStatus.ACTIVE,
      featureFlags: {},
      storageNamespace: 'tenants/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/',
    };
    const state: TenantExecutionContext = {
      tenant,
      manager: source.manager,
      active: true,
      afterCommit: [],
      afterRollback: [],
      pending: new Set(),
    };
    const recipient = { handshake: { headers: { host: 'a.nervion.ru' } }, emit: jest.fn(), disconnect: jest.fn() };
    const otherTenant = { handshake: { headers: { host: 'b.nervion.ru' } }, emit: jest.fn(), disconnect: jest.fn() };
    const platform = { getTenant: () => Promise.resolve(tenant) } as object as PlatformService;
    const database = Object.assign(new TenantDatabaseService(context), {
      run: async <T>(_tenant: TenantDescriptor, callback: () => Promise<T>) => callback(),
    });
    const sockets = Object.assign(new TenantSocketService({} as JwtAuthService, platform, database, context, source), {
      authenticate: (handshake: { headers: { host?: string } }) =>
        Promise.resolve({
          tenantId: handshake.headers.host === tenant.hostname ? tenant.id : 'other',
          userId: 7,
          role: 'employee',
        }),
    });
    const gateway = new WebsocketGateway(source, context, database, platform, sockets);
    const room = jest.fn(() => ({ fetchSockets: () => Promise.resolve([recipient, otherTenant]) }));
    gateway.server = Object.assign(new Server(), { in: room });
    context.run(state, () => gateway.sendNotificationAdded({ id: 5 } as Notifications, 7));
    expect(recipient.emit).not.toHaveBeenCalled();
    expect(state.afterCommit).toHaveLength(1);
    await state.afterCommit[0]();
    expect(room).toHaveBeenCalledWith('tenant:' + tenant.id);
    expect(recipient.emit).toHaveBeenCalledTimes(1);
    expect(otherTenant.emit).not.toHaveBeenCalled();
  });

  it('rejects a signed session belonging to another workspace during handshake', async () => {
    process.env.TENANCY_ENABLED = 'true';
    const context = new TenantContextService();
    const source = new DataSource({ type: 'postgres' });
    const jwt = { verifyToken: () => ({ id: 7, tenantId: 'other' }) } as object as JwtAuthService;
    const platform = {
      resolveTenant: () => Promise.resolve({ id: 'current' }),
      assertSession: () => Promise.reject(new Error('Session belongs to another tenant')),
    } as object as PlatformService;
    const sockets = new TenantSocketService(jwt, platform, new TenantDatabaseService(context), context, source);
    await expect(
      sockets.authenticate({
        headers: { host: 'a.nervion.ru', origin: 'https://a.nervion.ru', cookie: 'authToken=signed' },
      }),
    ).rejects.toThrow('Session belongs to another tenant');
  });
});
