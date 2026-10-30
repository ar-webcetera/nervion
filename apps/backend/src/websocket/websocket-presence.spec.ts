import { UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Server } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { WebsocketGateway } from './websocket.gateway';
import { TenantSocketService } from './tenant-socket.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PlatformService } from '../platform/platform.service';
import { JwtAuthService } from '../auth/jwt.service';
import { SOCKET_EVENT_TYPE } from './constants/socket';

describe('realtime presence session revocation', () => {
  const db = new DataSource({ type: 'postgres' });
  const context = new TenantContextService();
  const database = new TenantDatabaseService(context);
  const platform = new PlatformService(null, new ConfigService(), {} as ModuleRef);
  const sockets = new TenantSocketService({} as JwtAuthService, platform, database, context, db);
  const gateway = new WebsocketGateway(db, context, database, platform, sockets);
  const peer = (id: string, userId: number) => ({
    id,
    data: { nervion: { tenantId: 'tenant', userId, role: 'employee' } },
    handshake: { headers: { cookie: id } },
    emit: jest.fn(),
    disconnect: jest.fn(),
  });

  afterEach(() => jest.restoreAllMocks());

  it('disconnects revoked listeners and excludes them from online audiences and roster', async () => {
    const current = peer('current', 1);
    const valid = peer('valid', 2);
    const revoked = peer('revoked', 3);
    const fakeServer = Object.assign(new Server(), {
      in: jest.fn(() => ({ fetchSockets: jest.fn().mockResolvedValue([current, valid, revoked]) })),
    });
    gateway.server = fakeServer;
    jest.spyOn(sockets, 'authenticate').mockImplementation((handshake) => {
      const candidate = [current, valid].find((item) => item.handshake.headers.cookie === handshake.headers.cookie);
      if (!candidate) return Promise.reject(new UnauthorizedException());
      return Promise.resolve(candidate.data.nervion);
    });
    await gateway.handleConnection(current);
    expect(revoked.disconnect).toHaveBeenCalledWith(true);
    expect(revoked.emit).not.toHaveBeenCalled();
    expect(current.emit).toHaveBeenCalledWith('event', { type: SOCKET_EVENT_TYPE.users_online, data: { userIds: ['1', '2'] } });
    expect(valid.emit).toHaveBeenCalledWith('event', { type: SOCKET_EVENT_TYPE.user_online, data: { userId: '1' } });
  });

  it('does not deliver offline events to a revoked listener', async () => {
    const departing = peer('departing', 1);
    const valid = peer('valid', 2);
    const revoked = peer('revoked', 3);
    const fakeServer = Object.assign(new Server(), {
      in: jest.fn(() => ({ fetchSockets: jest.fn().mockResolvedValue([valid, revoked]) })),
    });
    gateway.server = fakeServer;
    jest.spyOn(sockets, 'authenticate').mockImplementation((handshake) => {
      if (handshake.headers.cookie !== 'valid') return Promise.reject(new UnauthorizedException());
      return Promise.resolve(valid.data.nervion);
    });
    await gateway.handleDisconnect(departing);
    expect(revoked.emit).not.toHaveBeenCalled();
    expect(revoked.disconnect).toHaveBeenCalledWith(true);
    expect(valid.emit).toHaveBeenCalledWith('event', { type: SOCKET_EVENT_TYPE.user_offline, data: { userId: '1' } });
  });
});
