import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpStatus } from '@nestjs/common';
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
  };

  const mockUsersRepository = {
    findOneBy: jest.fn<Promise<Users | null>, [object]>(),
  };

  const mockTasksRepository = {
    findOneBy: jest.fn<Promise<Tasks | null>, [object]>(),
  };

  const mockProjectMembersRepository = {};
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
  });
});
