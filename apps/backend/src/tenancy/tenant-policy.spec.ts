import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { TenantStatus } from '@tracker/contracts';
import { PlatformService } from '../platform/platform.service';
import { TenantContextService } from './tenant-context.service';
import { TenantDatabaseService } from './tenant-database.service';
import { TenantMiddleware } from './tenant.middleware';
import { TenantSocketService } from '../websocket/tenant-socket.service';
import { JwtAuthService } from '../auth/jwt.service';

describe('tenant route and WebSocket policy matching', () => {
  const context = new TenantContextService();
  const database = new TenantDatabaseService(context);
  const platform = new PlatformService(null, new ConfigService(), {} as ModuleRef);
  const middleware = new TenantMiddleware(context, database, platform);
  const originalEnv = process.env.NODE_ENV;
  let runSpy: jest.SpyInstance;
  let resolveTenantSpy: jest.SpyInstance;
  const response = () => ({ setHeader: jest.fn(), vary: jest.fn() }) as Pick<Response, 'setHeader' | 'vary'> as Response;

  beforeEach(() => {
    jest.spyOn(context, 'isEnabled').mockReturnValue(true);
    resolveTenantSpy = jest.spyOn(platform, 'resolveTenant').mockResolvedValue({
      id: 'tenant',
      slug: 'client',
      hostname: 'client.example.test',
      status: TenantStatus.ACTIVE,
      databaseShardId: 'data_1',
      storageNamespace: 'tenants/tenant/',
      readOnly: false,
      featureFlags: { tasks: false },
    });
    runSpy = jest.spyOn(database, 'run');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  it.each(['/api/Git/repos', '/API/VOICE/rooms', '/api/Mailbox/accounts', '/api/HealthChecks'])(
    'requires explicit opt-in for integrations with mixed-case Express paths: %s',
    async (path) => {
      const request = { originalUrl: path, headers: { host: 'client.example.test' }, method: 'GET' } as Request;
      await expect(middleware.use(request, response(), jest.fn())).rejects.toBeInstanceOf(ForbiddenException);
      expect(runSpy).not.toHaveBeenCalled();
    },
  );

  it('cannot bypass a disabled feature using route casing', async () => {
    const request = { originalUrl: '/api/TaSkS?order=DESC', headers: { host: 'client.example.test' }, method: 'GET' } as Request;
    await expect(middleware.use(request, response(), jest.fn())).rejects.toBeInstanceOf(ForbiddenException);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it.each(['http://client.example.test', 'https://client.example.test:8443', 'ftp://client.example.test'])(
    'rejects a noncanonical production HTTP Origin: %s',
    async (origin) => {
      process.env.NODE_ENV = 'production';
      const request = { originalUrl: '/api/auth/me', headers: { host: 'client.example.test', origin }, method: 'GET' } as Request;
      await expect(middleware.use(request, response(), jest.fn())).rejects.toBeInstanceOf(ForbiddenException);
      expect(runSpy).not.toHaveBeenCalled();
    },
  );

  it('rejects a non-HTTP development Origin', async () => {
    process.env.NODE_ENV = 'development';
    const request = {
      originalUrl: '/api/auth/me',
      headers: { host: 'client.example.test', origin: 'ftp://client.example.test' },
      method: 'GET',
    } as Request;
    await expect(middleware.use(request, response(), jest.fn())).rejects.toBeInstanceOf(ForbiddenException);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it.each(['http://client.example.test', 'https://client.example.test:8443', 'ftp://client.example.test'])(
    'rejects a noncanonical production WebSocket Origin: %s',
    async (origin) => {
      process.env.NODE_ENV = 'production';
      const jwt = { verifyToken: jest.fn(() => ({ id: 1, email: 'user@example.test', role: 'employee' })) } as Pick<
        JwtAuthService,
        'verifyToken'
      > as JwtAuthService;
      const sockets = new TenantSocketService(jwt, platform, database, context, new DataSource({ type: 'postgres' }));
      await expect(
        sockets.authenticate({
          headers: { host: 'client.example.test', origin, cookie: 'authToken=token' },
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(resolveTenantSpy).not.toHaveBeenCalled();
    },
  );
});
