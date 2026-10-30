import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Server } from 'socket.io';
import { VoiceGateway } from './voice.gateway';
import { VoiceService } from './voice.service';
import { VoiceRoomsService } from './voice-rooms.service';
import { VoiceClusterService } from './voice-cluster.service';
import { VoiceCommand } from './voice.enums';
import { VoicePeer, VoiceRequest } from './voice.protocol';
import { TenantSocketService } from '../websocket/tenant-socket.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PlatformService } from '../platform/platform.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { Users } from '../users/entities/users.entity';
import { ROLES } from '../common/enums/roles.enum';

describe('voice owner authorization', () => {
  const peer: VoicePeer = { tenantId: 'tenant-a', userId: 1, socketId: 'socket-a', headers: { cookie: 'authToken=a' } };
  const request: VoiceRequest = { peer, command: VoiceCommand.CreateTransport, body: { roomId: 7, direction: 'send' } };
  let gateway: VoiceGateway;
  let sockets: { authenticateConnected: jest.Mock; identity: jest.Mock };
  let rooms: { canJoin: jest.Mock };
  let voice: { getRoomParticipants: jest.Mock; closeRoom: jest.Mock; assertParticipant: jest.Mock; createTransport: jest.Mock };
  let platform: { getTenant: jest.Mock };
  let database: { run: jest.Mock };
  let live: { handshake: { headers: { cookie: string } }; data: object };

  beforeEach(() => {
    sockets = { authenticateConnected: jest.fn().mockResolvedValue({ tenantId: peer.tenantId, userId: peer.userId, role: ROLES.employee }), identity: jest.fn() };
    rooms = { canJoin: jest.fn().mockResolvedValue(true) };
    voice = { getRoomParticipants: jest.fn().mockReturnValue([]), closeRoom: jest.fn(), assertParticipant: jest.fn(), createTransport: jest.fn() };
    platform = { getTenant: jest.fn().mockResolvedValue({ id: peer.tenantId, readOnly: false, featureFlags: { voice: true } }) };
    database = { run: jest.fn().mockImplementation(async (_tenant: object, callback: () => Promise<object>) => callback()) };
    const context = { isEnabled: () => true };
    const cluster = { bind: jest.fn(), assertOwnership: jest.fn(), release: jest.fn().mockResolvedValue(undefined) };
    gateway = new VoiceGateway(
      voice as Partial<VoiceService> as VoiceService,
      rooms as Partial<VoiceRoomsService> as VoiceRoomsService,
      {} as WebsocketGateway,
      sockets as Partial<TenantSocketService> as TenantSocketService,
      context as TenantContextService,
      database as Partial<TenantDatabaseService> as TenantDatabaseService,
      platform as Partial<PlatformService> as PlatformService,
      cluster as Partial<VoiceClusterService> as VoiceClusterService,
      {} as Repository<Users>,
    );
    live = { handshake: { headers: { cookie: 'authToken=a' } }, data: {} };
    gateway.server = { in: jest.fn().mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([live]) }) } as Partial<Server> as Server;
  });

  it('rejects an internal request whose tenant differs from the real live socket', async () => {
    sockets.authenticateConnected.mockResolvedValue({ tenantId: 'tenant-b', userId: 1, role: ROLES.employee });
    const result = await gateway['execute'](request);
    expect(result.error).toBeTruthy();
    expect(voice.createTransport).not.toHaveBeenCalled();
    expect(database.run).not.toHaveBeenCalled();
  });

  it('rejects spoofed session headers even for an existing socket ID', async () => {
    const result = await gateway['execute']({ ...request, peer: { ...peer, headers: { cookie: 'authToken=other' } } });
    expect(result.error).toBeTruthy();
    expect(voice.createTransport).not.toHaveBeenCalled();
  });

  it.each([
    { readOnly: true, featureFlags: { voice: true } },
    { readOnly: false, featureFlags: { voice: false } },
    { readOnly: false, featureFlags: {} },
  ])('rejects calls when platform policy forbids voice: %o', async (policy) => {
    platform.getTenant.mockResolvedValue({ id: peer.tenantId, ...policy });
    const result = await gateway['execute'](request);
    expect(result.error).toBeTruthy();
    expect(voice.createTransport).not.toHaveBeenCalled();
  });

  it('does not accept a revoked membership on the owning SFU', async () => {
    sockets.authenticateConnected.mockRejectedValue(new ForbiddenException('membership revoked'));
    const result = await gateway['execute'](request);
    expect(result.error).toBeTruthy();
    expect(voice.createTransport).not.toHaveBeenCalled();
  });

  it('checks room membership in a fresh tenant transaction', async () => {
    rooms.canJoin.mockResolvedValue(false);
    const result = await gateway['execute'](request);
    expect(result.error).toBeTruthy();
    expect(database.run).toHaveBeenCalledWith(expect.objectContaining({ id: peer.tenantId }), expect.any(Function), { readOnly: true, actorId: 1 });
    expect(voice.createTransport).not.toHaveBeenCalled();
  });
});
