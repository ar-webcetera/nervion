import { DataSource } from 'typeorm';
import { Server } from 'socket.io';
import { WebsocketGateway } from './websocket.gateway';
import { JwtAuthService } from '../auth/jwt.service';

describe('CRM socket isolation', () => {
  it('checks a signed cookie and current database role, never handshake user_id', async () => {
    const admin = { handshake: { headers: { cookie: 'authToken=valid-admin' }, auth: { user_id: '1' } }, emit: jest.fn() };
    const employee = { handshake: { headers: { cookie: 'authToken=valid-employee' }, auth: { user_id: '1' } }, emit: jest.fn() };
    const forged = { handshake: { headers: { cookie: 'authToken=forged' }, auth: { user_id: '1' } }, emit: jest.fn() };
    const anonymous = { handshake: { headers: {}, auth: { user_id: '1' } }, emit: jest.fn() };
    const existsBy = jest.fn(({ id }: { id: number }) => Promise.resolve(id === 1));
    const gateway = new WebsocketGateway(
      Object.assign(new DataSource({ type: 'postgres' }), { getRepository: () => ({ existsBy }) }),
      {
        verifyToken: (token: string) => {
          if (token === 'valid-admin') return { id: 1 };
          if (token === 'valid-employee') return { id: 2 };
          throw new Error('Invalid signature');
        },
      } as JwtAuthService,
    );
    gateway.server = Object.assign(new Server(), { fetchSockets: () => Promise.resolve([admin, employee, forged, anonymous]) });
    await gateway.sendCrmChanged();
    expect(admin.emit).toHaveBeenCalledWith('crm:changed', undefined);
    expect(employee.emit).not.toHaveBeenCalled();
    expect(forged.emit).not.toHaveBeenCalled();
    expect(anonymous.emit).not.toHaveBeenCalled();
    existsBy.mockResolvedValue(false);
    admin.emit.mockClear();
    await gateway.sendCrmChanged();
    expect(admin.emit).not.toHaveBeenCalled();
  });
});
