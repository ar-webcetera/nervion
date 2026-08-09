import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, HttpStatus } from '@nestjs/common';
import { UNBOUND_TIMELOG_TITLE } from '@tracker/contracts';
import { ROLES } from '../common/enums/roles.enum';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ProjectMembers } from '../projects/entities/project.entity';
import { Tasks } from '../tasks/entities/task.entity';
import { Users } from '../users/entities/users.entity';
import { TIMELOG_STATUSES } from '../common/enums/statuses.enum';
import { CreateTimelogDto } from './dto/create-timelog.dto';
import { UpdateTimelogDto } from './dto/update-timelog.dto';
import { Timelogs } from './entities/timelog.entity';
import { TimelogsService } from './timelogs.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';

describe('TimelogsService', () => {
  let service: TimelogsService;

  const mockTimelogRepository = {
    save: jest.fn<Promise<Timelogs>, [Partial<Timelogs>]>(),
    findOne: jest.fn<Promise<Timelogs | null>, [object]>(),
    findOneBy: jest.fn<Promise<Timelogs | null>, [object]>(),
    find: jest.fn<Promise<Timelogs[]>, [object]>(),
    delete: jest.fn(),
  };

  const mockUsersRepository = {
    findOneBy: jest.fn<Promise<Users | null>, [object]>(),
  };

  const mockTasksRepository = {
    findOneBy: jest.fn<Promise<Tasks | null>, [object]>(),
  };

  const mockProjectMembersRepository = {
    findOne: jest.fn<Promise<{ id: number } | null>, [object]>(),
  };
  const mockAuditLogsService = {
    record: jest.fn(),
  };
  const mockWebsocketGateway = {
    sendTimelogUpdated: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimelogsService,
        { provide: getRepositoryToken(Timelogs), useValue: mockTimelogRepository },
        { provide: getRepositoryToken(Users), useValue: mockUsersRepository },
        { provide: getRepositoryToken(Tasks), useValue: mockTasksRepository },
        { provide: getRepositoryToken(ProjectMembers), useValue: mockProjectMembersRepository },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: WebsocketGateway, useValue: mockWebsocketGateway },
      ],
    }).compile();

    service = module.get<TimelogsService>(TimelogsService);
    jest.clearAllMocks();
  });

  describe('createTimelog', () => {
    it('должен сохранять таймлог, конвертируя минуты в секунды', async () => {
      const author = { id: 2 } as Users;
      const task = { id: 10 } as Tasks;
      const dto = Object.assign(new CreateTimelogDto(), {
        author_id: 2,
        task_id: 10,
        time_spent: 30,
        status: TIMELOG_STATUSES.in_progress,
      });

      mockUsersRepository.findOneBy.mockResolvedValue(author);
      mockTasksRepository.findOneBy.mockResolvedValue(task);
      mockTimelogRepository.save.mockResolvedValue({ id: 1 } as Timelogs);
      mockTimelogRepository.findOne.mockResolvedValue({
        id: 1,
        author,
        task,
        author_id: 2,
        task_id: 10,
        status: TIMELOG_STATUSES.in_progress,
        time_spent: 1800,
      } as Timelogs);

      const result = await service.createTimelog(dto);
      const savedPayload = mockTimelogRepository.save.mock.calls[0]?.[0];

      expect(savedPayload).toMatchObject({
        author,
        task,
        time_spent: 1800,
        status: TIMELOG_STATUSES.in_progress,
      });
      expect(typeof savedPayload?.change_status_at).toBe('number');
      expect(result).toMatchObject({
        id: 1,
        author,
      });
    });

    it('должен сохранять tracking_date для повторяющейся задачи', async () => {
      const author = { id: 2 } as Users;
      const task = { id: 10 } as Tasks;
      const dto = Object.assign(new CreateTimelogDto(), {
        author_id: 2,
        task_id: 10,
        tracking_date: '2026-04-19',
      });

      mockUsersRepository.findOneBy.mockResolvedValue(author);
      mockTasksRepository.findOneBy.mockResolvedValue(task);
      mockTimelogRepository.save.mockResolvedValue({ id: 2 } as Timelogs);
      mockTimelogRepository.findOne.mockResolvedValue({
        id: 2,
        author,
        task,
        author_id: 2,
        task_id: 10,
        tracking_date: '2026-04-19',
      } as Timelogs);

      await service.createTimelog(dto);

      expect(mockTimelogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          task,
          author,
          tracking_date: '2026-04-19',
        }),
      );
    });

    it('должен выбрасывать 404, если автор не найден', async () => {
      const dto = Object.assign(new CreateTimelogDto(), {
        author_id: 2,
        task_id: 10,
      });

      mockUsersRepository.findOneBy.mockResolvedValue(null);

      await expect(service.createTimelog(dto)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('должен выбрасывать 404, если задача не найдена', async () => {
      const dto = Object.assign(new CreateTimelogDto(), {
        author_id: 2,
        task_id: 10,
      });

      mockUsersRepository.findOneBy.mockResolvedValue({ id: 2 } as Users);
      mockTasksRepository.findOneBy.mockResolvedValue(null);

      await expect(service.createTimelog(dto)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });
  });

  describe('updateTimelog', () => {
    it('должен переводить таймлог в paused и доначислять секунды', async () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(10_000);
      mockTimelogRepository.findOneBy.mockResolvedValue({
        id: 1,
        status: TIMELOG_STATUSES.in_progress,
        time_spent: 20,
        change_status_at: 5_000,
      } as Timelogs);

      await service.updateTimelog(
        1,
        Object.assign(new UpdateTimelogDto(), {
          status: TIMELOG_STATUSES.paused,
        }),
      );

      expect(mockTimelogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          status: TIMELOG_STATUSES.paused,
          time_spent: 25,
          change_status_at: 10_000,
        }),
      );

      nowSpy.mockRestore();
    });

    it('должен сохранять summary при переводе running-таймлога в completed', async () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(10_000);
      mockTimelogRepository.findOneBy.mockResolvedValue({
        id: 1,
        status: TIMELOG_STATUSES.in_progress,
        time_spent: 20,
        change_status_at: 5_000,
        task_id: 10,
      } as Timelogs);

      await service.updateTimelog(
        1,
        Object.assign(new UpdateTimelogDto(), {
          status: TIMELOG_STATUSES.completed,
          summary: 'Готово',
        }),
      );

      expect(mockTimelogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          status: TIMELOG_STATUSES.completed,
          time_spent: 20,
          summary: 'Готово',
          change_status_at: 10_000,
        }),
      );

      nowSpy.mockRestore();
    });

    it('должен сохранять summary при переводе таймлога в completed с явным time_spent', async () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(10_000);
      mockTimelogRepository.findOneBy.mockResolvedValue({
        id: 1,
        status: TIMELOG_STATUSES.in_progress,
        time_spent: 20,
        change_status_at: 5_000,
        task_id: 10,
      } as Timelogs);

      await service.updateTimelog(
        1,
        Object.assign(new UpdateTimelogDto(), {
          status: TIMELOG_STATUSES.completed,
          summary: 'Готово',
          time_spent: 120,
        }),
      );

      expect(mockTimelogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          status: TIMELOG_STATUSES.completed,
          time_spent: 20,
          summary: 'Готово',
          change_status_at: 10_000,
        }),
      );

      nowSpy.mockRestore();
    });

    it('должен выбрасывать 404, если таймлог не найден', async () => {
      mockTimelogRepository.findOneBy.mockResolvedValue(null);

      await expect(service.updateTimelog(1, new UpdateTimelogDto())).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('должен запрещать complete у таймлога без задачи', async () => {
      mockTimelogRepository.findOneBy.mockResolvedValue({
        id: 1,
        status: TIMELOG_STATUSES.paused,
        time_spent: 20,
        change_status_at: 5_000,
        task_id: null,
      } as unknown as Timelogs);

      await expect(
        service.updateTimelog(1, Object.assign(new UpdateTimelogDto(), { status: TIMELOG_STATUSES.completed, summary: 'x' })),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it('должен привязывать задачу и затирать title', async () => {
      mockTimelogRepository.findOneBy.mockResolvedValue({
        id: 5,
        status: TIMELOG_STATUSES.paused,
        time_spent: 60,
        change_status_at: 1_000,
        task_id: null,
        title: 'Без задачи',
      } as unknown as Timelogs);
      mockTasksRepository.findOneBy.mockResolvedValue({ id: 42 } as Tasks);
      mockTimelogRepository.save.mockImplementation((t) => Promise.resolve(t as Timelogs));
      mockTimelogRepository.findOne.mockResolvedValue({ id: 5, task_id: 42 } as Timelogs);

      await service.updateTimelog(5, Object.assign(new UpdateTimelogDto(), { task_id: 42 }));

      expect(mockTimelogRepository.save).toHaveBeenCalledWith(expect.objectContaining({ id: 5, task_id: 42, title: null }));
    });
  });

  describe('права доступа', () => {
    const stranger = { id: 99, role: ROLES.employee } as AuthenticatedUser;

    it('должен запрещать редактировать чужой таймлог', async () => {
      mockTimelogRepository.findOneBy.mockResolvedValue({
        id: 1,
        author_id: 2,
        status: TIMELOG_STATUSES.paused,
      } as Timelogs);

      await expect(service.updateTimelog(1, Object.assign(new UpdateTimelogDto(), { task_id: 42 }), stranger)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('должен запрещать удалять чужой таймлог', async () => {
      mockTimelogRepository.findOne.mockResolvedValue({ id: 1, author_id: 2 } as Timelogs);

      await expect(service.deleteTimelog(1, stranger)).rejects.toThrow(ForbiddenException);
      expect(mockTimelogRepository.delete).not.toHaveBeenCalled();
    });

    it('должен запрещать привязку к задаче из недоступного проекта', async () => {
      mockTimelogRepository.findOneBy.mockResolvedValue({
        id: 1,
        author_id: stranger.id,
        status: TIMELOG_STATUSES.paused,
        task_id: null,
      } as unknown as Timelogs);
      mockTasksRepository.findOneBy.mockResolvedValue({ id: 42, project_id: 7 } as Tasks);
      mockProjectMembersRepository.findOne.mockResolvedValue(null);

      await expect(service.updateTimelog(1, Object.assign(new UpdateTimelogDto(), { task_id: 42 }), stranger)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('должен разрешать привязку к задаче доступного проекта', async () => {
      mockTimelogRepository.findOneBy.mockResolvedValue({
        id: 1,
        author_id: stranger.id,
        status: TIMELOG_STATUSES.paused,
        task_id: null,
        title: UNBOUND_TIMELOG_TITLE,
      } as unknown as Timelogs);
      mockTasksRepository.findOneBy.mockResolvedValue({ id: 42, project_id: 7 } as Tasks);
      mockProjectMembersRepository.findOne.mockResolvedValue({ id: 3 });
      mockTimelogRepository.save.mockImplementation((t) => Promise.resolve(t as Timelogs));
      mockTimelogRepository.findOne.mockResolvedValue({ id: 1, task_id: 42 } as Timelogs);

      await service.updateTimelog(1, Object.assign(new UpdateTimelogDto(), { task_id: 42 }), stranger);

      expect(mockTimelogRepository.save).toHaveBeenCalledWith(expect.objectContaining({ task_id: 42, title: null }));
    });

    it('должен запрещать создание таймлога от имени другого пользователя', async () => {
      const dto = Object.assign(new CreateTimelogDto(), { author_id: 2, task_id: 10 });

      await expect(service.createTimelog(dto, stranger)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createTimelog (unbound)', () => {
    it('должен создавать таймер без задачи с дефолтным title', async () => {
      const author = { id: 2 } as Users;
      const dto = Object.assign(new CreateTimelogDto(), {
        author_id: 2,
        status: TIMELOG_STATUSES.in_progress,
      });

      mockUsersRepository.findOneBy.mockResolvedValue(author);
      mockTimelogRepository.save.mockResolvedValue({ id: 7 } as Timelogs);
      mockTimelogRepository.findOne.mockResolvedValue({
        id: 7,
        author,
        author_id: 2,
        task_id: null,
        title: 'Без задачи',
        status: TIMELOG_STATUSES.in_progress,
      } as unknown as Timelogs);

      await service.createTimelog(dto);
      const savedPayload = mockTimelogRepository.save.mock.calls[0]?.[0];

      expect(savedPayload).toMatchObject({ author, title: 'Без задачи' });
      expect(savedPayload).not.toHaveProperty('task');
    });

    it('должен запрещать сразу создавать completed без задачи', async () => {
      const author = { id: 2 } as Users;
      const dto = Object.assign(new CreateTimelogDto(), {
        author_id: 2,
        status: TIMELOG_STATUSES.completed,
      });
      mockUsersRepository.findOneBy.mockResolvedValue(author);

      await expect(service.createTimelog(dto)).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });
  });
});
