import { Test, TestingModule } from '@nestjs/testing';
import { TasksService } from './tasks.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Tasks } from './entities/task.entity';
import { TaskCompletion } from './entities/task-completion.entity';
import { Projects, ProjectMembers } from '../projects/entities/project.entity';
import { Users } from '../users/entities/users.entity';
import { Comments } from '../comments/entities/comment.entity';
import { UserTaskFilter } from './entities/user-task-filter.entity';
import { DataSource } from 'typeorm';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { DeepseekService } from '../deepseek/deepseek.service';
import { TASK_STATUSES, TIMELOG_STATUSES } from '../common/enums/statuses.enum';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { FindTasksByFilterDto } from './dto/find-tasks-by-filter.dto';
import { ROLES } from '../common/enums/roles.enum';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PROJECT_STATUSES } from '../common/enums/project-status.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateNotificationDto } from '../notifications/dto/create-notification.dto';
import { Notifications } from '../notifications/entities/notification.entity';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ConfigService } from '@nestjs/config';
import { FixedRevenue } from '../reportings/entities/fixed-revenue.entity';
import { Timelogs } from '../timelogs/entities/timelog.entity';
import { BillingReviewStatus, TaskBillingType } from '@tracker/contracts';

type QueryParamValue = string | number | boolean | null | undefined | Date | string[] | number[] | Date[];
type QueryParams = Record<string, QueryParamValue>;

const createAuthenticatedUser = (id: number): AuthenticatedUser => ({ id }) as AuthenticatedUser;

type QueryBuilderMock = {
  leftJoinAndSelect: jest.Mock<QueryBuilderMock, [string, string]>;
  leftJoin: jest.Mock<QueryBuilderMock, [string, string, string, QueryParams]>;
  innerJoin: jest.Mock<QueryBuilderMock, [string, string, string, QueryParams]>;
  where: jest.Mock<QueryBuilderMock, [string, QueryParams?]>;
  andWhere: jest.Mock<QueryBuilderMock, [string, QueryParams?]>;
  orderBy: jest.Mock<QueryBuilderMock, [string, 'ASC' | 'DESC']>;
  getMany: jest.Mock<Promise<Tasks[]>, []>;
};

const createQueryBuilderMock = (): QueryBuilderMock => {
  const qb = {} as QueryBuilderMock;
  qb.leftJoinAndSelect = jest.fn<QueryBuilderMock, [string, string]>(() => qb);
  qb.leftJoin = jest.fn<QueryBuilderMock, [string, string, string, QueryParams]>(() => qb);
  qb.innerJoin = jest.fn<QueryBuilderMock, [string, string, string, QueryParams]>(() => qb);
  qb.where = jest.fn<QueryBuilderMock, [string, QueryParams?]>(() => qb);
  qb.andWhere = jest.fn<QueryBuilderMock, [string, QueryParams?]>(() => qb);
  qb.orderBy = jest.fn<QueryBuilderMock, [string, 'ASC' | 'DESC']>(() => qb);
  qb.getMany = jest.fn<Promise<Tasks[]>, []>().mockResolvedValue([]);
  return qb;
};

describe('TasksService', () => {
  let service: TasksService;

  const mockTasksRepository = {
    create: jest.fn<Partial<Tasks>, [Partial<Tasks>]>((task) => task),
    save: jest.fn<Promise<Tasks>, [Partial<Tasks>]>().mockResolvedValue({ id: 1 } as Tasks),
    update: jest.fn<Promise<{ affected: number }>, [string, Partial<Tasks>]>().mockResolvedValue({ affected: 1 }),
    findOne: jest.fn<Promise<Partial<Tasks> | null>, [object?]>(),
    createQueryBuilder: jest.fn<QueryBuilderMock, [string]>(),
  };

  const mockProjectsRepository = {
    findOne: jest.fn<Promise<Projects | null>, [object?]>(),
  };
  const mockProjectMembersRepository = {};
  const mockUsersRepository = {
    findOne: jest.fn<Promise<Users | null>, [object?]>(),
  };
  const mockWebsocketGateway = {
    sendTaskUpdate: jest.fn(),
    sendTaskAdded: jest.fn(),
    sendTaskDeleted: jest.fn(),
  };
  const mockCommentRepository = {};
  const mockUserTaskFilterRepository = {};
  const mockCompletionRepository = {
    findOne: jest.fn<Promise<TaskCompletion | null>, [object?]>(),
    save: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn<QueryBuilderMock, [string]>(),
  };
  const mockFixedRevenueRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };
  const mockTimelogRepository = {
    update: jest.fn(),
  };
  const mockDeepseekService = {};
  const mockDataSource = {
    transaction: jest.fn(),
  };
  const mockAuditLogsService = {
    record: jest.fn(),
  };
  const mockNotificationsService = {
    createWithEmail: jest.fn<Promise<Notifications>, [CreateNotificationDto, string]>().mockResolvedValue({} as Notifications),
  };
  const mockConfigService = {
    get: jest.fn<string | undefined, [string]>().mockReturnValue('webcetera.test'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: getRepositoryToken(Tasks),
          useValue: mockTasksRepository,
        },
        {
          provide: getRepositoryToken(Projects),
          useValue: mockProjectsRepository,
        },
        {
          provide: getRepositoryToken(ProjectMembers),
          useValue: mockProjectMembersRepository,
        },
        {
          provide: getRepositoryToken(Users),
          useValue: mockUsersRepository,
        },
        {
          provide: getRepositoryToken(TaskCompletion),
          useValue: mockCompletionRepository,
        },
        {
          provide: getRepositoryToken(FixedRevenue),
          useValue: mockFixedRevenueRepository,
        },
        {
          provide: getRepositoryToken(Timelogs),
          useValue: mockTimelogRepository,
        },
        {
          provide: getRepositoryToken(Comments),
          useValue: mockCommentRepository,
        },
        {
          provide: getRepositoryToken(UserTaskFilter),
          useValue: mockUserTaskFilterRepository,
        },
        {
          provide: WebsocketGateway,
          useValue: mockWebsocketGateway,
        },
        {
          provide: DeepseekService,
          useValue: mockDeepseekService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: AuditLogsService,
          useValue: mockAuditLogsService,
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    jest.clearAllMocks();
    mockProjectsRepository.findOne.mockResolvedValue({ id: 1, name: 'Проект' } as Projects);
    mockUsersRepository.findOne.mockResolvedValue({ id: 1 } as Users);
    mockTasksRepository.findOne.mockResolvedValue({ id: 1, recurrence_days: null, priority: 1 } as Partial<Tasks>);
    mockTasksRepository.save.mockResolvedValue({ id: 1 } as Tasks);
  });

  it('должен быть определен', () => {
    expect(service).toBeDefined();
  });

  describe('createTask', () => {
    it('должен устанавливать closed_date при создании закрытой задачи', async () => {
      const createTaskDto = Object.assign(new CreateTaskDto(), {
        title: 'Тестовая задача',
        status: TASK_STATUSES.closed,
      });

      mockTasksRepository.findOne.mockResolvedValue({ priority: 1 });

      await service.createTask(createTaskDto);

      const createdTask = mockTasksRepository.create.mock.calls[0]?.[0];
      expect(createdTask?.status).toBe(TASK_STATUSES.closed);
      expect(createdTask?.closed_date).toBeInstanceOf(Date);
    });

    it('не должен устанавливать closed_date при создании открытой задачи', async () => {
      const createTaskDto = Object.assign(new CreateTaskDto(), {
        title: 'Тестовая задача',
        status: TASK_STATUSES.open,
      });

      mockTasksRepository.findOne.mockResolvedValue({ priority: 1 });

      await service.createTask(createTaskDto);

      expect(mockTasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TASK_STATUSES.open,
          closed_date: null,
        }),
      );
    });

    it('должен сохранять planned_date при создании задачи', async () => {
      const createTaskDto = Object.assign(new CreateTaskDto(), {
        title: 'Тестовая задача',
        planned_date: '2026-07-15',
      });

      mockTasksRepository.findOne.mockResolvedValue({ priority: 1 });

      await service.createTask(createTaskDto);

      expect(mockTasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          planned_date: '2026-07-15',
        }),
      );
    });

    it('должен добавлять ответственного в participants при создании задачи', async () => {
      const responsible = { id: 5 } as Users;
      const createTaskDto = Object.assign(new CreateTaskDto(), {
        title: 'Тестовая задача',
        responsible_id: 5,
      });

      mockTasksRepository.findOne.mockResolvedValue({ priority: 1 });
      mockUsersRepository.findOne.mockResolvedValue(responsible);

      await service.createTask(createTaskDto);

      expect(mockTasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          responsible,
          participants: [responsible],
        }),
      );
    });

    it('должен отправлять уведомление ответственному при создании задачи', async () => {
      const responsible = { id: 5 } as Users;
      const createTaskDto = Object.assign(new CreateTaskDto(), {
        title: 'Тестовая задача',
        responsible_id: 5,
      });

      mockUsersRepository.findOne.mockResolvedValue(responsible);
      mockTasksRepository.findOne
        .mockResolvedValueOnce({ priority: 1 } as Partial<Tasks>)
        .mockResolvedValueOnce({ id: 1, title: 'Тестовая задача' } as Partial<Tasks>);
      mockTasksRepository.save.mockResolvedValue({ id: 1, title: 'Тестовая задача' } as Tasks);

      await service.createTask(createTaskDto, createAuthenticatedUser(1));

      expect(mockNotificationsService.createWithEmail).toHaveBeenCalledWith(
        {
          name: 'Вам назначена задача: Тестовая задача',
          message: 'Вы назначены ответственным за задачу «Тестовая задача».',
          recipient_id: 5,
          link: '?task-id=1',
        },
        expect.stringContaining('https://tracker.webcetera.test?task-id=1'),
      );
    });

    it('должен выбрасывать 404, если проект не найден', async () => {
      const createTaskDto = Object.assign(new CreateTaskDto(), {
        title: 'Тестовая задача',
        project_id: 22,
      });

      mockProjectsRepository.findOne.mockResolvedValue(null);

      await expect(service.createTask(createTaskDto)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('updateTask', () => {
    it('должен сохранить почасовую модель и отправить завершённые таймтреки без решения на проверку', async () => {
      const updateTaskDto = Object.assign(new UpdateTaskDto(), {
        billing_type: TaskBillingType.HOURLY,
        fixed_price: null,
      });
      mockTasksRepository.findOne
        .mockResolvedValueOnce({ id: 1, billing_type: null, recurrence_days: null } as Partial<Tasks>)
        .mockResolvedValueOnce({ id: 1, billing_type: TaskBillingType.HOURLY, recurrence_days: null } as Partial<Tasks>);

      await service.updateTask('1', updateTaskDto, { id: 1, role: ROLES.admin } as AuthenticatedUser);

      expect(mockTasksRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, billing_type: TaskBillingType.HOURLY, fixed_price: null }),
      );
      expect(mockTimelogRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ task_id: 1, status: TIMELOG_STATUSES.completed }),
        { billing_status: BillingReviewStatus.PENDING },
      );
    });

    it('должен устанавливать closed_date при обновлении статуса на "Закрыто"', async () => {
      const updateTaskDto = Object.assign(new UpdateTaskDto(), {
        status: TASK_STATUSES.closed,
      });

      await service.updateTask('1', updateTaskDto);

      expect(mockTasksRepository.save).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
      const updatedTask = mockTasksRepository.save.mock.calls[0]?.[0];
      expect(updatedTask?.status).toBe(TASK_STATUSES.closed);
      expect(updatedTask?.closed_date).toBeInstanceOf(Date);
    });

    it('должен сбрасывать closed_date в null при смене статуса с "Закрыто" на другой', async () => {
      const updateTaskDto = Object.assign(new UpdateTaskDto(), {
        status: TASK_STATUSES.in_progress,
      });

      await service.updateTask('1', updateTaskDto);

      expect(mockTasksRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          status: TASK_STATUSES.in_progress,
          closed_date: null,
        }),
      );
    });

    it('не должен обновлять closed_date, если статус не передан', async () => {
      const updateTaskDto = Object.assign(new UpdateTaskDto(), {
        title: 'Новое название',
      });

      await service.updateTask('1', updateTaskDto);

      const updatedTask = mockTasksRepository.save.mock.calls[0]?.[0];
      expect(updatedTask?.title).toBe('Новое название');
      expect(updatedTask).not.toHaveProperty('closed_date');
    });

    it('должен сбрасывать responsible_id в null, если ответственный снят', async () => {
      const updateTaskDto = Object.assign(new UpdateTaskDto(), {
        responsible_id: null,
      });

      await service.updateTask('1', updateTaskDto);

      expect(mockTasksRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          responsible_id: null,
        }),
      );
    });

    it('должен отправлять уведомление при назначении нового ответственного', async () => {
      const updateTaskDto = Object.assign(new UpdateTaskDto(), {
        responsible_id: 42,
      });

      mockUsersRepository.findOne.mockResolvedValue({ id: 42 } as Users);
      mockTasksRepository.findOne
        .mockResolvedValueOnce({
          id: 1,
          title: 'Тестовая задача',
          responsible_id: 5,
          responsible: { id: 5 } as Users,
          recurrence_days: null,
        } as Partial<Tasks>)
        .mockResolvedValueOnce({
          id: 1,
          title: 'Тестовая задача',
          responsible_id: 42,
          responsible: { id: 42 } as Users,
          recurrence_days: null,
        } as Partial<Tasks>);

      await service.updateTask('1', updateTaskDto, createAuthenticatedUser(1));

      expect(mockNotificationsService.createWithEmail).toHaveBeenCalledWith(
        {
          name: 'Вам назначена задача: Тестовая задача',
          message: 'Вы назначены ответственным за задачу «Тестовая задача».',
          recipient_id: 42,
          link: '?task-id=1',
        },
        expect.stringContaining('https://tracker.webcetera.test?task-id=1'),
      );
    });

    it('не должен отправлять уведомление, если ответственный не изменился', async () => {
      const updateTaskDto = Object.assign(new UpdateTaskDto(), {
        responsible_id: 42,
      });

      mockUsersRepository.findOne.mockResolvedValue({ id: 42 } as Users);
      mockTasksRepository.findOne
        .mockResolvedValueOnce({
          id: 1,
          title: 'Тестовая задача',
          responsible_id: 42,
          responsible: { id: 42 } as Users,
          recurrence_days: null,
        } as Partial<Tasks>)
        .mockResolvedValueOnce({
          id: 1,
          title: 'Тестовая задача',
          responsible_id: 42,
          responsible: { id: 42 } as Users,
          recurrence_days: null,
        } as Partial<Tasks>);

      await service.updateTask('1', updateTaskDto, createAuthenticatedUser(1));

      expect(mockNotificationsService.createWithEmail).not.toHaveBeenCalled();
    });

    it('должен выбрасывать 404, если новый ответственный не найден', async () => {
      const updateTaskDto = Object.assign(new UpdateTaskDto(), {
        responsible_id: 42,
      });
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

      mockUsersRepository.findOne.mockResolvedValue(null);

      await expect(service.updateTask('1', updateTaskDto)).rejects.toMatchObject({
        status: 404,
      });

      consoleLogSpy.mockRestore();
    });

    it('должен проставлять recurrence_since при первом включении повторения', async () => {
      const updateTaskDto = Object.assign(new UpdateTaskDto(), {
        recurrence_days: [1, 3, 5],
      });

      mockTasksRepository.findOne.mockResolvedValueOnce({
        id: 1,
        recurrence_days: null,
        recurrence_since: null,
      });

      await service.updateTask('1', updateTaskDto);
      const updatedTask = mockTasksRepository.save.mock.calls[0]?.[0];

      expect(updatedTask).toMatchObject({
        id: 1,
        recurrence_days: [1, 3, 5],
      });
      expect(typeof updatedTask?.recurrence_since).toBe('string');
    });

    it('должен сбрасывать recurrence_since при очистке повторения', async () => {
      const updateTaskDto = Object.assign(new UpdateTaskDto(), {
        recurrence_days: [],
      });

      await service.updateTask('1', updateTaskDto);

      expect(mockTasksRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          recurrence_days: [],
          recurrence_since: null,
        }),
      );
    });

    it('должен фиксировать изменение описания в audit summary и payload', async () => {
      const oldDescription = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Старое описание' }] }],
      };
      const newDescription = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Новое описание' }] }],
      };
      const updateTaskDto = Object.assign(new UpdateTaskDto(), {
        description: newDescription,
      });

      mockTasksRepository.findOne
        .mockResolvedValueOnce({
          id: 1,
          title: 'Тестовая задача',
          description: oldDescription,
          recurrence_days: null,
        } as Partial<Tasks>)
        .mockResolvedValueOnce({
          id: 1,
          title: 'Тестовая задача',
          description: newDescription,
          recurrence_days: null,
        } as Partial<Tasks>);

      await service.updateTask('1', updateTaskDto);

      expect(mockAuditLogsService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: 'Обновлена задача "Тестовая задача" (изменено: описание)',
          beforePayload: expect.objectContaining({
            description: 'Старое описание',
          }),
          afterPayload: expect.objectContaining({
            description: 'Новое описание',
          }),
        }),
      );
    });

    it('должен фиксировать изменение описания при добавлении изображения без изменения текста', async () => {
      const oldDescription = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Описание задачи' }] }],
      };
      const newDescription = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Описание задачи' }] },
          { type: 'image', attrs: { src: 'https://cdn.example.com/image.png' } },
        ],
      };
      const updateTaskDto = Object.assign(new UpdateTaskDto(), {
        description: newDescription,
      });

      mockTasksRepository.findOne
        .mockResolvedValueOnce({
          id: 1,
          title: 'Тестовая задача',
          description: oldDescription,
          recurrence_days: null,
        } as Partial<Tasks>)
        .mockResolvedValueOnce({
          id: 1,
          title: 'Тестовая задача',
          description: newDescription,
          recurrence_days: null,
        } as Partial<Tasks>);

      await service.updateTask('1', updateTaskDto);

      expect(mockAuditLogsService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: 'Обновлена задача "Тестовая задача" (изменено: описание)',
          beforePayload: expect.objectContaining({
            description: 'Описание задачи',
          }),
          afterPayload: expect.objectContaining({
            description: expect.stringContaining('Изображение'),
          }),
        }),
      );
    });
  });

  describe('findTasksByFilter', () => {
    it('должен скрывать повторяющиеся задачи в обычном списке', async () => {
      const filters = new FindTasksByFilterDto();
      const user = { id: 1, role: ROLES.admin } as Users;
      const qb = createQueryBuilderMock();

      mockTasksRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findTasksByFilter(filters, user);

      expect(qb.andWhere).toHaveBeenCalledWith('task.recurrence_days IS NULL');
    });

    it('не должен скрывать повторяющиеся задачи в списке активных таймеров', async () => {
      const filters = Object.assign(new FindTasksByFilterDto(), { existTimelog: true });
      const user = { id: 11, role: ROLES.admin } as Users;
      const qb = createQueryBuilderMock();

      mockTasksRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findTasksByFilter(filters, user);

      expect(qb.andWhere).not.toHaveBeenCalledWith('task.recurrence_days IS NULL');
      expect(qb.innerJoin).toHaveBeenCalledWith(
        'task.timelog',
        'current_tl',
        'current_tl.author_id = :userId AND current_tl.status IN (:...tlStatuses)',
        {
          userId: 11,
          tlStatuses: ['in_progress', 'paused'],
        },
      );
    });

    it('должен ограничивать задачи проектами текущего сотрудника', async () => {
      const filters = new FindTasksByFilterDto();
      const user = { id: 7, role: ROLES.employee } as Users;
      const qb = createQueryBuilderMock();

      mockTasksRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findTasksByFilter(filters, user);

      expect(qb.leftJoin).toHaveBeenCalledWith(
        'project_members',
        'project_access',
        'project_access.project_id = task.project_id AND project_access.user_id = :userId',
        { userId: 7 },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('(task.project_id IS NULL OR project_access.id IS NOT NULL)');
    });

    it('должен скрывать задачи архивных проектов', async () => {
      const filters = new FindTasksByFilterDto();
      const user = { id: 1, role: ROLES.admin } as Users;
      const qb = createQueryBuilderMock();

      mockTasksRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findTasksByFilter(filters, user);

      expect(qb.andWhere).toHaveBeenCalledWith('(task.project_id IS NULL OR project.status != :archivedProjectStatus)', {
        archivedProjectStatus: PROJECT_STATUSES.ON_HOLD,
      });
    });

    it('должен добавлять условие фильтрации по closed_date', async () => {
      const filters = Object.assign(new FindTasksByFilterDto(), { closed_date: ['2025-10-02'] });
      const user = { id: 1, role: ROLES.admin } as Users;
      const qb = createQueryBuilderMock();

      mockTasksRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findTasksByFilter(filters, user);

      expect(qb.andWhere).toHaveBeenCalledWith(
        'DATE(task.closed_date) <= :closed_date',
        expect.objectContaining({ closed_date: '2025-10-02' }),
      );
    });

    it('должен добавлять условие фильтрации по planned_date с DATE()', async () => {
      const filters = Object.assign(new FindTasksByFilterDto(), { planned_date: ['2025-10-01'] });
      const user = { id: 1, role: ROLES.admin } as Users;
      const qb = createQueryBuilderMock();

      mockTasksRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findTasksByFilter(filters, user);

      expect(qb.andWhere).toHaveBeenCalledWith(
        'DATE(task.planned_date) <= :planned_date',
        expect.objectContaining({ planned_date: '2025-10-01' }),
      );
    });
  });

  describe('getWeeklyTasks', () => {
    it('должен скрывать повторяющиеся задачи архивных проектов', async () => {
      const user = { id: 1, role: ROLES.admin } as Users;
      const recurringQb = createQueryBuilderMock();
      const plannedQb = createQueryBuilderMock();
      const completionsQb = createQueryBuilderMock();

      mockTasksRepository.createQueryBuilder.mockReturnValueOnce(recurringQb).mockReturnValueOnce(plannedQb);
      mockCompletionRepository.createQueryBuilder.mockReturnValue(completionsQb);

      await service.getWeeklyTasks('2026-04-27', user);

      expect(recurringQb.andWhere).toHaveBeenCalledWith('(task.project_id IS NULL OR project.status != :archivedProjectStatus)', {
        archivedProjectStatus: PROJECT_STATUSES.ON_HOLD,
      });
    });

    it('должен показывать разовую задачу в день planned_date', async () => {
      const user = { id: 1, role: ROLES.admin } as Users;
      const recurringQb = createQueryBuilderMock();
      const plannedQb = createQueryBuilderMock();
      const completionsQb = createQueryBuilderMock();
      plannedQb.getMany.mockResolvedValue([
        {
          id: 42,
          title: 'Разовая задача',
          description: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Короткое описание задачи' }] }],
          },
          planned_date: new Date('2026-04-30'),
          recurrence_days: null,
        } as Partial<Tasks> as Tasks,
      ]);

      mockTasksRepository.createQueryBuilder.mockReturnValueOnce(recurringQb).mockReturnValueOnce(plannedQb);
      mockCompletionRepository.createQueryBuilder.mockReturnValue(completionsQb);

      const result = await service.getWeeklyTasks('2026-04-27', user);

      expect(result.columns.find((column) => column.date === '2026-04-30')?.cards).toEqual([
        expect.objectContaining({ id: 42, description: 'Короткое описание задачи', recurrence_days: null }),
      ]);
    });

    it('фильтр «Мои сегодня» должен объединять planned_date и повторение на выбранный день', async () => {
      const user = { id: 7, role: ROLES.admin } as Users;
      const recurringQb = createQueryBuilderMock();
      const plannedQb = createQueryBuilderMock();
      const completionsQb = createQueryBuilderMock();
      recurringQb.getMany.mockResolvedValue([
        {
          id: 51,
          title: 'Повторяющаяся задача',
          planned_date: new Date('2026-04-01'),
          recurrence_days: [3],
        } as Tasks,
      ]);
      plannedQb.getMany.mockResolvedValue([
        {
          id: 52,
          title: 'Разовая задача',
          planned_date: new Date('2026-04-29'),
          recurrence_days: null,
        } as Tasks,
      ]);

      mockTasksRepository.createQueryBuilder.mockReturnValueOnce(recurringQb).mockReturnValueOnce(plannedQb);
      mockCompletionRepository.createQueryBuilder.mockReturnValue(completionsQb);

      const filters = Object.assign(new FindTasksByFilterDto(), {
        planned_date: ['2026-04-29', '2026-04-29'],
        responsibles: [7],
      });
      const result = await service.getWeeklyTasks('2026-04-27', user, filters);

      expect(recurringQb.andWhere).not.toHaveBeenCalledWith('DATE(task.planned_date) = :planned_date', expect.anything());
      expect(result.columns.find((column) => column.date === '2026-04-29')?.cards).toEqual([
        expect.objectContaining({ id: 51 }),
        expect.objectContaining({ id: 52 }),
      ]);
      expect(result.columns.flatMap((column) => column.cards)).toHaveLength(2);
    });
  });
});
