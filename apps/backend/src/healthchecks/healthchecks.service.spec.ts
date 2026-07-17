import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HealthchecksService } from './healthchecks.service';
import { HealthCheck, HealthCheckStatus } from './entities/healthcheck.entity';
import { ChatsService } from '../chats/chats.service';

const makeHc = (overrides: Partial<HealthCheck> = {}): HealthCheck =>
  ({
    id: 1,
    name: 'Test API',
    url: 'http://example.com/health',
    interval_seconds: 60,
    timeout_seconds: 10,
    expected_status: 200,
    chat_id: 'chat-uuid',
    sender_user_id: 1,
    is_active: true,
    last_status: HealthCheckStatus.UNKNOWN,
    last_checked_at: null,
    last_error: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }) as HealthCheck;

describe('HealthchecksService', () => {
  let service: HealthchecksService;

  const mockRepo = {
    find: jest.fn(),
    findBy: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn((dto) => ({ ...makeHc(), ...dto })),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const mockChatsService = {
    sendSystemMessage: jest.fn(),
  };

  beforeEach(async () => {
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthchecksService,
        { provide: getRepositoryToken(HealthCheck), useValue: mockRepo },
        { provide: ChatsService, useValue: mockChatsService },
      ],
    }).compile();

    service = module.get<HealthchecksService>(HealthchecksService);
    (service as any).timers.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    (service as any).timers.forEach((t: NodeJS.Timeout) => clearInterval(t));
    (service as any).timers.clear();
    jest.useRealTimers();
  });

  it('должен быть определён', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('должен запустить таймеры для активных мониторов', async () => {
      const hcs = [makeHc({ id: 1 }), makeHc({ id: 2 })];
      mockRepo.findBy.mockResolvedValue(hcs);

      await service.onModuleInit();

      expect(mockRepo.findBy).toHaveBeenCalledWith({ is_active: true });
      expect((service as any).timers.size).toBe(2);
    });

    it('не должен запускать таймеры если активных мониторов нет', async () => {
      mockRepo.findBy.mockResolvedValue([]);

      await service.onModuleInit();

      expect((service as any).timers.size).toBe(0);
    });
  });

  describe('onModuleDestroy', () => {
    it('должен очищать все таймеры', async () => {
      mockRepo.findBy.mockResolvedValue([makeHc({ id: 1 }), makeHc({ id: 2 })]);
      await service.onModuleInit();
      expect((service as any).timers.size).toBe(2);

      service.onModuleDestroy();

      expect((service as any).timers.size).toBe(0);
    });
  });

  describe('findAll', () => {
    it('должен возвращать список мониторов', async () => {
      const list = [makeHc({ id: 1 }), makeHc({ id: 2 })];
      mockRepo.find.mockResolvedValue(list);

      const result = await service.findAll();

      expect(mockRepo.find).toHaveBeenCalledWith({ order: { id: 'ASC' } });
      expect(result).toBe(list);
    });
  });

  describe('findOne', () => {
    it('должен возвращать монитор по id', async () => {
      const hc = makeHc({ id: 5 });
      mockRepo.findOneBy.mockResolvedValue(hc);

      const result = await service.findOne(5);

      expect(result).toBe(hc);
    });

    it('должен выбрасывать ошибку если монитор не найден', async () => {
      mockRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow('Healthcheck #999 не найден');
    });
  });

  describe('create', () => {
    it('должен создавать монитор и запускать таймер если is_active=true', async () => {
      const dto = { name: 'New', url: 'http://x.com', interval_seconds: 30, chat_id: 'cid', sender_user_id: 1 };
      const saved = makeHc({ id: 10, is_active: true });
      mockRepo.save.mockResolvedValue(saved);

      const result = await service.create(dto as any);

      expect(mockRepo.save).toHaveBeenCalled();
      expect(result).toBe(saved);
      expect((service as any).timers.has(10)).toBe(true);
    });

    it('не должен запускать таймер если is_active=false', async () => {
      const saved = makeHc({ id: 11, is_active: false });
      mockRepo.save.mockResolvedValue(saved);

      await service.create({ name: 'x', url: 'http://x.com', interval_seconds: 30, chat_id: 'c', sender_user_id: 1 } as any);

      expect((service as any).timers.has(11)).toBe(false);
    });
  });

  describe('update', () => {
    it('должен обновлять монитор и перезапускать таймер', async () => {
      const existing = makeHc({ id: 1, is_active: true });
      const updated = makeHc({ id: 1, interval_seconds: 120, is_active: true });
      mockRepo.findOneBy.mockResolvedValue(existing);
      mockRepo.save.mockResolvedValue(updated);

      const result = await service.update(1, { interval_seconds: 120 });

      expect(result).toBe(updated);
      expect((service as any).timers.has(1)).toBe(true);
    });

    it('должен останавливать таймер при выключении монитора', async () => {
      const existing = makeHc({ id: 1, is_active: true });
      const updated = makeHc({ id: 1, is_active: false });
      mockRepo.findOneBy.mockResolvedValue(existing);
      mockRepo.save.mockResolvedValue(updated);

      (service as any).startTimer(existing);
      expect((service as any).timers.has(1)).toBe(true);

      await service.update(1, { is_active: false });

      expect((service as any).timers.has(1)).toBe(false);
    });
  });

  describe('remove', () => {
    it('должен останавливать таймер и удалять монитор', async () => {
      const hc = makeHc({ id: 3 });
      (service as any).startTimer(hc);
      expect((service as any).timers.has(3)).toBe(true);

      await service.remove(3);

      expect(mockRepo.delete).toHaveBeenCalledWith(3);
      expect((service as any).timers.has(3)).toBe(false);
    });
  });

  describe('toggle', () => {
    it('должен включать неактивный монитор', async () => {
      const hc = makeHc({ id: 1, is_active: false });
      const toggled = makeHc({ id: 1, is_active: true });
      mockRepo.findOneBy.mockResolvedValue(hc);
      mockRepo.save.mockResolvedValue(toggled);

      const result = await service.toggle(1);

      expect(result.is_active).toBe(true);
    });

    it('должен выключать активный монитор', async () => {
      const hc = makeHc({ id: 1, is_active: true });
      const toggled = makeHc({ id: 1, is_active: false });
      mockRepo.findOneBy.mockResolvedValue(hc);
      mockRepo.save.mockResolvedValue(toggled);

      const result = await service.toggle(1);

      expect(result.is_active).toBe(false);
    });
  });

  describe('runCheck (логика проверок)', () => {
    let httpGetSpy: jest.SpyInstance;

    beforeEach(() => {
      httpGetSpy = jest.spyOn(service as any, 'httpGet');
    });

    it('unknown → ok: статус обновляется, алерт не отправляется', async () => {
      const hc = makeHc({ id: 1, last_status: HealthCheckStatus.UNKNOWN });
      mockRepo.findOneBy.mockResolvedValue(hc);
      mockRepo.save.mockResolvedValue(hc);
      httpGetSpy.mockResolvedValue(200);

      await (service as any).runCheck(1);

      expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ last_status: HealthCheckStatus.OK }));
      expect(mockChatsService.sendSystemMessage).not.toHaveBeenCalled();
    });

    it('unknown → fail: статус обновляется, отправляется алерт о падении', async () => {
      const hc = makeHc({ id: 1, last_status: HealthCheckStatus.UNKNOWN });
      mockRepo.findOneBy.mockResolvedValue(hc);
      mockRepo.save.mockResolvedValue(hc);
      httpGetSpy.mockResolvedValue(500);

      await (service as any).runCheck(1);

      expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ last_status: HealthCheckStatus.FAIL }));
      expect(mockChatsService.sendSystemMessage).toHaveBeenCalledTimes(1);
      const msg = mockChatsService.sendSystemMessage.mock.calls[0][2];
      expect(JSON.stringify(msg)).toContain('Недоступен');
    });

    it('fail → fail: повторный алерт не отправляется', async () => {
      const hc = makeHc({ id: 1, last_status: HealthCheckStatus.FAIL });
      mockRepo.findOneBy.mockResolvedValue(hc);
      mockRepo.save.mockResolvedValue(hc);
      httpGetSpy.mockResolvedValue(503);

      await (service as any).runCheck(1);

      expect(mockChatsService.sendSystemMessage).not.toHaveBeenCalled();
    });

    it('fail → ok: отправляется алерт о восстановлении', async () => {
      const hc = makeHc({ id: 1, last_status: HealthCheckStatus.FAIL });
      mockRepo.findOneBy.mockResolvedValue(hc);
      mockRepo.save.mockResolvedValue(hc);
      httpGetSpy.mockResolvedValue(200);

      await (service as any).runCheck(1);

      expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ last_status: HealthCheckStatus.OK }));
      expect(mockChatsService.sendSystemMessage).toHaveBeenCalledTimes(1);
      const msg = mockChatsService.sendSystemMessage.mock.calls[0][2];
      expect(JSON.stringify(msg)).toContain('Восстановлен');
    });

    it('ok → ok: алерт не отправляется', async () => {
      const hc = makeHc({ id: 1, last_status: HealthCheckStatus.OK });
      mockRepo.findOneBy.mockResolvedValue(hc);
      mockRepo.save.mockResolvedValue(hc);
      httpGetSpy.mockResolvedValue(200);

      await (service as any).runCheck(1);

      expect(mockChatsService.sendSystemMessage).not.toHaveBeenCalled();
    });

    it('сетевая ошибка: статус FAIL, алерт с текстом ошибки', async () => {
      const hc = makeHc({ id: 1, last_status: HealthCheckStatus.UNKNOWN });
      mockRepo.findOneBy.mockResolvedValue(hc);
      mockRepo.save.mockResolvedValue(hc);
      httpGetSpy.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await (service as any).runCheck(1);

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          last_status: HealthCheckStatus.FAIL,
          last_error: 'connect ECONNREFUSED',
        }),
      );
      expect(mockChatsService.sendSystemMessage).toHaveBeenCalledTimes(1);
    });

    it('не должен запускать проверку если монитор выключен', async () => {
      const hc = makeHc({ id: 1, is_active: false });
      mockRepo.findOneBy.mockResolvedValue(hc);

      await (service as any).runCheck(1);

      expect(mockRepo.save).not.toHaveBeenCalled();
      expect(mockChatsService.sendSystemMessage).not.toHaveBeenCalled();
    });

    it('не должен запускать проверку если монитор не найден', async () => {
      mockRepo.findOneBy.mockResolvedValue(null);

      await (service as any).runCheck(999);

      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('sendAlert', () => {
    it('не должен падать если sendSystemMessage выбрасывает ошибку', async () => {
      const hc = makeHc();
      mockChatsService.sendSystemMessage.mockRejectedValue(new Error('chat error'));

      await expect((service as any).sendAlert(hc, 'timeout', false)).resolves.not.toThrow();
    });
  });
});
