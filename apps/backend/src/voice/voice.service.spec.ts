import * as mediasoup from 'mediasoup';
import type { Producer, Router, WebRtcTransport, Worker } from 'mediasoup/node/lib/types';
import { VoiceService, ProducerSource } from './voice.service';
import { voiceRoomKey } from './voice.protocol';

jest.mock('mediasoup', () => ({ createWorker: jest.fn() }));

describe('tenant voice SFU ownership', () => {
  let service: VoiceService;
  const routers: Router[] = [];
  const tenantA = voiceRoomKey('11111111-1111-4111-8111-111111111111', 7);
  const tenantB = voiceRoomKey('22222222-2222-4222-8222-222222222222', 7);

  beforeEach(async () => {
    routers.length = 0;
    const worker: Partial<Worker> = {
      on: jest.fn(), close: jest.fn(),
      createRouter: jest.fn().mockImplementation(async () => {
        const router: Partial<Router> = {
          close: jest.fn(), closed: false, rtpCapabilities: { codecs: [] },
          canConsume: jest.fn().mockReturnValue(true),
        };
        routers.push(router as Router);
        return router;
      }),
    };
    jest.mocked(mediasoup.createWorker).mockResolvedValue(worker as Worker);
    service = new VoiceService();
    await service.onModuleInit();
    await service.getOrCreateRoom(tenantA);
    await service.getOrCreateRoom(tenantB);
    service.addParticipant(tenantA, 1, 'a', 'Tenant A', null);
    service.addParticipant(tenantB, 1, 'b', 'Tenant B', null);
  });

  afterEach(() => service.onModuleDestroy());

  it('isolates identical room and user IDs in different tenants', () => {
    expect(service.getRoomParticipants(tenantA).map((item) => item.socketId)).toEqual(['a']);
    expect(service.getRoomParticipants(tenantB).map((item) => item.socketId)).toEqual(['b']);
    expect(() => service.assertParticipant(tenantA, 1, 'b')).toThrow('Нет доступа');
    service.removeParticipant(tenantA, 1);
    expect(service.getRoomParticipants(tenantB)).toHaveLength(1);
    expect(routers[1].close).not.toHaveBeenCalled();
  });

  it('rejects transport belonging to another user in the same room', async () => {
    service.addParticipant(tenantA, 2, 'a2', 'Other user', null);
    const transport = { id: 'transport-a', connect: jest.fn(), produce: jest.fn(), close: jest.fn() } as Partial<WebRtcTransport> as WebRtcTransport;
    service.registerSendTransport(tenantA, 1, transport);
    await expect(service.connectTransport(tenantA, 2, transport.id, { fingerprints: [] })).rejects.toThrow('not found');
    await expect(service.produce(tenantA, 2, transport.id, 'audio', { codecs: [] }, { source: ProducerSource.Microphone })).rejects.toThrow('Нет доступа');
    expect(transport.connect).not.toHaveBeenCalled();
    expect(transport.produce).not.toHaveBeenCalled();
  });

  it('rejects producer ID from another tenant even if router.canConsume returns true', async () => {
    const producer = { id: 'producer-a', kind: 'audio', close: jest.fn() } as Partial<Producer> as Producer;
    service.getRoomParticipants(tenantA)[0].producers.set(producer.id, producer);
    await expect(service.consume(tenantB, 1, producer.id, { codecs: [] })).rejects.toThrow('Cannot consume');
  });

  it('does not replace another active socket for the same user', () => {
    expect(() => service.addParticipant(tenantA, 1, 'attacker', 'Other', null)).toThrow('другой вкладке');
    expect(service.getRoomParticipants(tenantA)[0].socketId).toBe('a');
  });

  it('reuses router creation under concurrent joins', async () => {
    const [left, right] = await Promise.all([service.getOrCreateRoom('new:8'), service.getOrCreateRoom('new:8')]);
    expect(left).toBe(right);
    expect(routers).toHaveLength(3);
  });
});
