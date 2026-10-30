import { VoiceClusterService } from './voice-cluster.service';
import { VoiceCommand } from './voice.enums';
import { VoiceRequest, voiceRoomKey } from './voice.protocol';

describe('voice SFU leases and RPC fencing', () => {
  const originalTenancy = process.env.TENANCY_ENABLED;
  const request: VoiceRequest = {
    command: VoiceCommand.Join,
    peer: {
      tenantId: 'tenant-a',
      userId: 1,
      socketId: 'socket-a',
      headers: { host: 'a.example.test', cookie: 'authToken=test' },
    },
    body: { roomId: 7 },
  };
  const key = voiceRoomKey(request.peer.tenantId, request.body.roomId);
  let cluster: VoiceClusterService;
  let redis: { isReady: boolean; get: jest.Mock; eval: jest.Mock; publish: jest.Mock };
  let leases: Map<string, number>;
  let handler: jest.Mock;
  let lost: jest.Mock;

  beforeEach(() => {
    process.env.TENANCY_ENABLED = 'true';
    cluster = new VoiceClusterService();
    redis = {
      isReady: true,
      get: jest.fn().mockResolvedValue(cluster.nodeId),
      eval: jest.fn().mockResolvedValue(1),
      publish: jest.fn(),
    };
    leases = new Map([[key, Date.now()]]);
    handler = jest.fn().mockResolvedValue({ connected: true });
    lost = jest.fn();
    Object.assign(cluster, { redis, subscriber: { isReady: true }, leases });
    cluster.bind(handler, lost);
  });

  afterEach(() => {
    if (originalTenancy === undefined) delete process.env.TENANCY_ENABLED;
    else process.env.TENANCY_ENABLED = originalTenancy;
  });

  it('checks Redis ownership before every local command', async () => {
    redis.get.mockResolvedValue('another-owner');
    await expect(cluster.assertOwnership(key)).rejects.toThrow('сессия завершена');
    expect(lost).toHaveBeenCalledWith(key);
    expect(handler).not.toHaveBeenCalled();
  });

  it('fences an expired local lease even while Redis still contains the old node ID', async () => {
    leases.set(key, Date.now() - 20001);
    await expect(cluster.execute(request)).rejects.toThrow('сессия завершена');
    expect(handler).not.toHaveBeenCalled();
    expect(lost).toHaveBeenCalledWith(key);
  });

  it('does not execute an RPC envelope that claims a different owner', async () => {
    await cluster['receive'](
      JSON.stringify({
        id: '11111111-1111-4111-8111-111111111111',
        source: '22222222-2222-4222-8222-222222222222',
        owner: 'spoofed-owner',
        deadline: Date.now() + 5000,
        request,
      }),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('serializes commands within a tenant room', async () => {
    const order: string[] = [];
    let unblock: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    handler.mockImplementationOnce(async () => {
      order.push('first');
      await pending;
      return {};
    });
    handler.mockImplementationOnce(() => {
      order.push('second');
      return Promise.resolve({});
    });
    const first = cluster.execute(request);
    const second = cluster.execute(request);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).not.toContain('second');
    unblock();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('rejects commands during a Redis outage without a local fallback', async () => {
    redis.isReady = false;
    await expect(cluster.execute(request)).rejects.toThrow('кластер недоступен');
    expect(handler).not.toHaveBeenCalled();
  });
});
