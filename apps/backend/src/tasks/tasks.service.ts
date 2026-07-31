import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AuditActionType, AuditEntityType, type JsonObject } from '@tracker/contracts';
import { FindTasksByFilterDto } from './dto/find-tasks-by-filter.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MAX_TASK_NAME_LENGTH, Tasks, TaskType } from './entities/task.entity';
import { TaskCompletion } from './entities/task-completion.entity';
import { DataSource, DeepPartial, Repository, SelectQueryBuilder } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Projects } from '../projects/entities/project.entity';
import { Users } from '../users/entities/users.entity';
import { TASK_STATUSES, TIMELOG_STATUSES } from '../common/enums/statuses.enum';
import { UpdatePriorityTaskDto } from './dto/update-priority-task.dto';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { Comments } from '../comments/entities/comment.entity';
import { ROLES } from '../common/enums/roles.enum';
import { ProjectMembers } from '../projects/entities/project.entity';
import { PROJECT_STATUSES } from '../common/enums/project-status.enum';
import { format, startOfWeek, addDays } from 'date-fns';
import { extractPlainText, ExtractPlainTextMode } from 'src/common/utils/extractPlainText';
import { extractFirstImage } from 'src/common/utils/extractFirstImage';
import { TiptapDoc } from 'src/common/types/tiptap';
import { DeepseekService } from '../deepseek/deepseek.service';
import { CreateAndLinkDto } from './dto/create-and-link.dto';
import { Filter, TaskViewType, UserTaskFilter } from './entities/user-task-filter.entity';
import { UpdateFilterStateDto } from './dto/update-filter-state.dto';
import * as XLSX from 'xlsx';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { NotificationsService } from '../notifications/notifications.service';
import { ConfigService } from '@nestjs/config';

interface TaskAuditPayload extends JsonObject {
  title: string | null;
  description: string | null;
  status: TASK_STATUSES | null;
  project_id: number | null;
  responsible_id: number | null;
  taskType: TaskType | null;
  planned_date: string | null;
  story_points: number | null;
  recurrence_days: number[] | null;
  recurrence_since: string | null;
  closed_date: string | null;
}

interface ResponsibleAssignedNotificationPayload {
  taskId: number;
  taskTitle: string;
  responsibleId: number;
  actorId?: number;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly deepseekService: DeepseekService,
    private readonly dataSource: DataSource,
    @InjectRepository(Tasks)
    private readonly tasksRepository: Repository<Tasks>,
    @InjectRepository(TaskCompletion)
    private readonly completionRepository: Repository<TaskCompletion>,
    @InjectRepository(Projects)
    private readonly projectsRepository: Repository<Projects>,
    @InjectRepository(ProjectMembers)
    private readonly projectsMembersRepository: Repository<ProjectMembers>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private readonly websocketGateway: WebsocketGateway,
    @InjectRepository(Comments)
    private readonly commentRepository: Repository<Comments>,
    @InjectRepository(UserTaskFilter)
    private readonly userTaskFilterRepository: Repository<UserTaskFilter>,
    private readonly auditLogsService: AuditLogsService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
  ) {}

  async findTasksByFilter(findTasksByFilterDto: FindTasksByFilterDto, currentUser: AuthenticatedUser) {
    const qb = await this.buildFilteredTasksQuery(findTasksByFilterDto, currentUser);
    return qb.getMany();
  }

  private async buildFilteredTasksQuery(
    findTasksByFilterDto: FindTasksByFilterDto,
    currentUser: AuthenticatedUser,
  ): Promise<SelectQueryBuilder<Tasks>> {
    const filters = await this.resolveFilters(findTasksByFilterDto, currentUser.id);
    const { projects, responsibles, statuses, existTimelog, planned_date, closed_date, year, taskTypes, title, negativeFilters } =
      filters;

    const qb = this.buildBaseQuery(currentUser, existTimelog);

    this.applyProjectsFilter(qb, projects, negativeFilters);
    this.applyResponsiblesFilter(qb, responsibles, negativeFilters);
    this.applyStatusesFilter(qb, statuses, negativeFilters);
    this.applyDateFilter(qb, 'planned_date', planned_date, negativeFilters, 'date');
    this.applyDateFilter(qb, 'closed_date', closed_date, negativeFilters, 'closed_date', findTasksByFilterDto.timezone);
    this.applyTaskTypesFilter(qb, taskTypes, negativeFilters);
    this.applyTitleFilter(qb, title);
    this.applyYearFilter(qb, year);

    qb.orderBy('task.priority', 'DESC');
    return qb;
  }

  private async resolveFilters(dto: FindTasksByFilterDto, userId: number): Promise<Filter> {
    if (dto.useSavedFilters) {
      const savedFilters = await this.getUserFilterState(userId);
      if (!savedFilters) {
        throw new HttpException('Фильтры не найдены', HttpStatus.NOT_FOUND);
      }
      return savedFilters;
    }
    return dto;
  }

  private notifyResponsibleAssigned({ taskId, taskTitle, responsibleId, actorId }: ResponsibleAssignedNotificationPayload): void {
    if (actorId === responsibleId) return;

    const subject = `Вам назначена задача: ${taskTitle}`;
    const message = `Вы назначены ответственным за задачу «${taskTitle}».`;
    const link = `?task-id=${taskId}`;
    const domain = this.configService.get<string>('APP_DOMAIN');
    const absoluteLink = `https://tracker.${domain}${link}`;

    void this.notificationsService
      .createWithEmail(
        {
          name: subject,
          message,
          recipient_id: responsibleId,
          link,
        },
        `<p>Вы назначены ответственным за новую задачу.</p><p><a href="${absoluteLink}" target="_blank" rel="noopener noreferrer">Перейти к задаче</a></p>`,
      )
      .catch((err) => console.error('Ошибка создания уведомления о назначении ответственного', err));
  }

  private buildBaseQuery(currentUser: AuthenticatedUser, existTimelog?: boolean): SelectQueryBuilder<Tasks> {
    const qb = this.tasksRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.responsible', 'responsible')
      .leftJoinAndSelect('task.project', 'project')
      .leftJoinAndSelect('task.participants', 'participants');

    if (!existTimelog) {
      qb.andWhere('task.recurrence_days IS NULL');
    }

    this.applyProjectAccessScope(qb, currentUser);
    this.applyActiveProjectScope(qb);

    if (existTimelog) {
      const tlStatuses = [TIMELOG_STATUSES.in_progress, TIMELOG_STATUSES.paused];
      qb.innerJoin('task.timelog', 'current_tl', 'current_tl.author_id = :userId AND current_tl.status IN (:...tlStatuses)', {
        userId: currentUser.id,
        tlStatuses,
      });
    }

    return qb;
  }

  private applyProjectAccessScope(qb: SelectQueryBuilder<Tasks>, currentUser: AuthenticatedUser) {
    if (currentUser.role === ROLES.admin) {
      return;
    }

    qb.leftJoin(
      'project_members',
      'project_access',
      'project_access.project_id = task.project_id AND project_access.user_id = :userId',
      {
        userId: currentUser.id,
      },
    );
    qb.andWhere('(task.project_id IS NULL OR project_access.id IS NOT NULL)');
  }

  private applyActiveProjectScope(qb: SelectQueryBuilder<Tasks>) {
    qb.andWhere('(task.project_id IS NULL OR project.status != :archivedProjectStatus)', {
      archivedProjectStatus: PROJECT_STATUSES.ON_HOLD,
    });
  }

  private applyProjectsFilter(qb: SelectQueryBuilder<Tasks>, projects?: number[], negativeFilters?: Record<string, boolean>) {
    if (!projects?.length) return;

    const { positive, negative } = this.splitByNegative(projects, (id) => `project-${id}`, negativeFilters);

    if (positive.length) {
      qb.andWhere('project.id IN (:...positiveProjects)', { positiveProjects: positive });
    }
    if (negative.length) {
      qb.andWhere('(project.id NOT IN (:...negativeProjects) OR project.id IS NULL)', { negativeProjects: negative });
    }
  }

  private applyResponsiblesFilter(
    qb: SelectQueryBuilder<Tasks>,
    responsibles?: number[],
    negativeFilters?: Record<string, boolean>,
  ) {
    if (!responsibles?.length) return;

    const { positive, negative } = this.splitByNegative(responsibles, (id) => `responsible-${id}`, negativeFilters);

    if (positive.length) {
      qb.andWhere('responsible.id IN (:...positiveResponsibles)', { positiveResponsibles: positive });
    }
    if (negative.length) {
      qb.andWhere('(responsible.id NOT IN (:...negativeResponsibles) OR responsible.id IS NULL)', {
        negativeResponsibles: negative,
      });
    }
  }

  private applyStatusesFilter(qb: SelectQueryBuilder<Tasks>, statuses?: string[], negativeFilters?: Record<string, boolean>) {
    if (!statuses?.length) return;

    const { positive, negative } = this.splitByNegative(statuses, (status) => `status-${status}`, negativeFilters);

    if (positive.length) {
      qb.andWhere('task.status IN (:...positiveStatuses)', { positiveStatuses: positive });
    }
    if (negative.length) {
      qb.andWhere('(task.status NOT IN (:...negativeStatuses) OR task.status IS NULL)', { negativeStatuses: negative });
    }
  }

  private toUtcRange(dateStr: string, timezone: string): { start: Date; end: Date } {
    const getOffsetMs = (isoStr: string): number => {
      const d = new Date(isoStr);
      const utcStr = d.toLocaleString('en-US', { timeZone: 'UTC' });
      const tzStr = d.toLocaleString('en-US', { timeZone: timezone });
      return new Date(utcStr).getTime() - new Date(tzStr).getTime();
    };

    const [year, month, day] = dateStr.split('-').map(Number);
    const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toISOString();
    const offset = getOffsetMs(noonUtc);

    return {
      start: new Date(Date.UTC(year, month - 1, day, 0, 0, 0) + offset),
      end: new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) + offset),
    };
  }

  private formatDatetime(date: Date | string | null, timezone?: string, includeTime = false): string {
    if (!date) return '';
    const d = new Date(date as string);
    if (!timezone) {
      return includeTime ? format(d, 'dd.MM.yyyy HH:mm') : format(d, 'dd.MM.yyyy');
    }
    const opts: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
    };
    return new Intl.DateTimeFormat('ru-RU', opts).format(d);
  }

  private applyDateFilter(
    qb: SelectQueryBuilder<Tasks>,
    field: 'planned_date' | 'closed_date',
    dates?: string[],
    negativeFilters?: Record<string, boolean>,
    chipPrefix?: string,
    timezone?: string,
  ) {
    if (!dates?.length) return;

    const chipId = `${chipPrefix || field}-${dates.join('-')}`;
    const isNegative = negativeFilters?.[chipId];
    const fieldName = `task.${field}`;

    if (field === 'closed_date' && timezone) {
      this.applyUtcDateFilter(qb, fieldName, field, dates, timezone, isNegative);
    } else {
      this.applyLocalDateFilter(qb, fieldName, field, dates, isNegative);
    }
  }

  private applyUtcDateFilter(
    qb: SelectQueryBuilder<Tasks>,
    fieldName: string,
    field: string,
    dates: string[],
    timezone: string,
    isNegative?: boolean,
  ) {
    const isRange = dates.length >= 2;
    const { start } = this.toUtcRange(dates[0], timezone);
    const { end } = this.toUtcRange(dates[isRange ? 1 : 0], timezone);

    if (isRange) {
      const sp = `start_${field}`;
      const ep = `end_${field}`;
      if (isNegative) {
        qb.andWhere(`(${fieldName} < :${sp} OR ${fieldName} > :${ep} OR ${fieldName} IS NULL)`, { [sp]: start, [ep]: end });
      } else {
        qb.andWhere(`${fieldName} >= :${sp} AND ${fieldName} <= :${ep}`, { [sp]: start, [ep]: end });
      }
    } else {
      const ep = `end_${field}`;
      if (isNegative) {
        qb.andWhere(`(${fieldName} > :${ep} OR ${fieldName} IS NULL)`, { [ep]: end });
      } else {
        qb.andWhere(`${fieldName} <= :${ep}`, { [ep]: end });
      }
    }
  }

  private applyLocalDateFilter(
    qb: SelectQueryBuilder<Tasks>,
    fieldName: string,
    field: string,
    dates: string[],
    isNegative?: boolean,
  ) {
    const [d0, d1] = dates.map((d) => format(new Date(d), 'yyyy-MM-dd'));

    if (dates.length === 2 && d0 !== d1) {
      const sp = `start_${field}`;
      const ep = `end_${field}`;
      if (isNegative) {
        qb.andWhere(`(DATE(${fieldName}) NOT BETWEEN :${sp} AND :${ep} OR ${fieldName} IS NULL)`, { [sp]: d0, [ep]: d1 });
      } else {
        qb.andWhere(`DATE(${fieldName}) BETWEEN :${sp} AND :${ep}`, { [sp]: d0, [ep]: d1 });
      }
    } else if (dates.length === 2) {
      if (isNegative) {
        qb.andWhere(`(DATE(${fieldName}) != :${field} OR ${fieldName} IS NULL)`, { [field]: d0 });
      } else {
        qb.andWhere(`DATE(${fieldName}) = :${field}`, { [field]: d0 });
      }
    } else {
      if (isNegative) {
        qb.andWhere(`(DATE(${fieldName}) > :${field} OR ${fieldName} IS NULL)`, { [field]: d0 });
      } else {
        qb.andWhere(`DATE(${fieldName}) <= :${field}`, { [field]: d0 });
      }
    }
  }

  private applyTaskTypesFilter(qb: SelectQueryBuilder<Tasks>, taskTypes?: string[], negativeFilters?: Record<string, boolean>) {
    if (!taskTypes?.length) return;

    const { positive, negative } = this.splitByNegative(taskTypes, (type) => `taskType-${type}`, negativeFilters);

    if (positive.length) {
      qb.andWhere('task.taskType IN (:...positiveTaskTypes)', { positiveTaskTypes: positive });
    }
    if (negative.length) {
      qb.andWhere('task.taskType NOT IN (:...negativeTaskTypes)', { negativeTaskTypes: negative });
    }
  }

  private applyTitleFilter(qb: SelectQueryBuilder<Tasks>, title?: string) {
    if (title) {
      qb.andWhere('task.title ILIKE :title', { title: `%${title}%` });
    }
  }

  private applyYearFilter(qb: SelectQueryBuilder<Tasks>, year?: string) {
    if (year) {
      const y = Number(year);
      const start = new Date(y, 0, 1);
      const end = new Date(y + 1, 0, 1);
      qb.andWhere('task.planned_date BETWEEN :start AND :end', { start, end });
    }
  }

  private splitByNegative<T>(
    items: T[],
    keyFn: (item: T) => string,
    negativeFilters?: Record<string, boolean>,
  ): { positive: T[]; negative: T[] } {
    const positive: T[] = [];
    const negative: T[] = [];

    for (const item of items) {
      const key = keyFn(item);
      if (negativeFilters?.[key]) {
        negative.push(item);
      } else {
        positive.push(item);
      }
    }

    return { positive, negative };
  }

  async getKanban(getKanbanByFilterDto: FindTasksByFilterDto, currentUser: AuthenticatedUser) {
    const userFilter = await this.userTaskFilterRepository.findOne({ where: { user_id: currentUser.id } });
    const collapsedColumns = new Set(userFilter?.collapsed_columns ?? []);
    const KANBAN_PAGE = 50;

    const columnDefs = [
      { id: 1, title: 'Открыто', status: TASK_STATUSES.open },
      { id: 2, title: 'К выполнению', status: TASK_STATUSES.to_do },
      { id: 3, title: 'Выполняется', status: TASK_STATUSES.in_progress },
      { id: 4, title: 'На ревью', status: TASK_STATUSES.in_review },
      { id: 5, title: 'На тестировании', status: TASK_STATUSES.testing },
      { id: 6, title: 'Готово к релизу', status: TASK_STATUSES.ready_for_release },
      { id: 9, title: 'Проверка на проде', status: TASK_STATUSES.prod_check },
      { id: 7, title: 'Контроль', status: TASK_STATUSES.control },
      { id: 8, title: 'Закрыто', status: TASK_STATUSES.closed },
    ];

    const columns = await Promise.all(
      columnDefs.map(async (def) => {
        const { cards, total } = await this.fetchKanbanColumnPage(getKanbanByFilterDto, def.status, 0, KANBAN_PAGE, currentUser);
        return {
          id: def.id,
          title: def.title,
          status: def.status,
          cards,
          total,
          collapsed: collapsedColumns.has(def.status),
        };
      }),
    );

    return columns;
  }

  async getKanbanColumn(
    getKanbanByFilterDto: FindTasksByFilterDto,
    status: TASK_STATUSES,
    offset: number,
    limit: number,
    currentUser: AuthenticatedUser,
  ) {
    const { cards, total } = await this.fetchKanbanColumnPage(getKanbanByFilterDto, status, offset, limit, currentUser);
    return { status, total, cards };
  }

  private async fetchKanbanColumnPage(
    getKanbanByFilterDto: FindTasksByFilterDto,
    status: TASK_STATUSES,
    offset: number,
    limit: number,
    currentUser: AuthenticatedUser,
  ) {
    const qb = await this.buildFilteredTasksQuery(getKanbanByFilterDto, currentUser);
    qb.andWhere('task.status = :columnStatus', { columnStatus: status });
    qb.skip(offset).take(limit);

    const [tasks, total] = await qb.getManyAndCount();
    return { cards: tasks.map((task) => this.mapKanbanCard(task)), total };
  }

  private mapKanbanCard(task: Tasks) {
    return {
      id: task.id,
      title: task.title,
      taskType: task.taskType,
      description: extractPlainText(task.description as TiptapDoc, 80),
      users: task.responsible?.photo_url ? [task.responsible?.photo_url] : [],
      status: task.status,
      priority: task.priority,
      projectName: task.project?.name,
      coverImage: extractFirstImage(task.description as TiptapDoc),
      story_points: task.story_points,
      planned_date: task.planned_date,
      closed_date: task.closed_date,
    };
  }

  async findTaskById(task_id: number, currentUser: AuthenticatedUser) {
    const task = await this.tasksRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.responsible', 'responsible')
      .leftJoinAndSelect('task.project', 'project')
      .leftJoinAndSelect('task.participants', 'participants')
      .leftJoinAndSelect('task.related_tasks', 'related_tasks')
      .leftJoinAndSelect('related_tasks.responsible', 'related_tasks_responsible')
      .leftJoin('project_members', 'pm', 'pm.project_id = project.id AND pm.user_id = :user_id', { user_id: currentUser.id })
      .where('task.id = :task_id', { task_id })
      .getOne();

    if (!task) {
      throw new HttpException(
        {
          message: [`Задача с id=${task_id} не найдена`],
        },
        HttpStatus.NOT_FOUND,
      );
    }
    const isAdmin = currentUser.role === ROLES.admin;
    if (!isAdmin && task.project) {
      const hasAccess = await this.projectsMembersRepository.exist({
        where: {
          project: { id: task.project.id },
          user: { id: currentUser.id },
        },
      });
      if (!hasAccess) {
        throw new HttpException({ message: [`У вас нет доступа к проекту задачи id=${task_id}`] }, HttpStatus.FORBIDDEN);
      }
    }

    let is_completed_today = false;
    if (task.recurrence_days?.length) {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const completion = await this.completionRepository.findOne({
        where: { task_id: task.id, completed_at: todayStr },
      });
      is_completed_today = !!completion;
    }

    return { ...task, is_completed_today };
  }

  async createTask(createTaskDto: CreateTaskDto, currentUser?: AuthenticatedUser) {
    let project: Projects | null = null;
    if (createTaskDto.project_id) {
      project = await this.projectsRepository.findOne({
        where: { id: createTaskDto.project_id },
      });
      if (!project) {
        throw new HttpException(
          {
            message: [`Проект с id=${createTaskDto.project_id} не найден`],
          },
          HttpStatus.NOT_FOUND,
        );
      }
    }

    let responsible: Users | null = null;
    if (createTaskDto.responsible_id) {
      responsible = await this.usersRepository.findOne({
        where: { id: createTaskDto.responsible_id },
      });
      if (!responsible) {
        throw new HttpException(
          {
            message: [`Пользователь-ответственный с id=${createTaskDto.responsible_id} не найден`],
          },
          HttpStatus.NOT_FOUND,
        );
      }
    }

    const last = await this.tasksRepository.findOne({
      select: ['priority'],
      order: { priority: 'DESC' },
      where: {},
    });
    const maxPriority = last?.priority ?? 0;

    const status = createTaskDto.status ?? TASK_STATUSES.open;
    const data: DeepPartial<Tasks> = {
      title: createTaskDto.title,
      status,
      priority: Number(maxPriority) + 1,
      taskType: createTaskDto.taskType ?? TaskType.TASK,
      description: createTaskDto.description,
      closed_date: this.resolveClosedDate(status),
    };

    if (project) data.project = project;
    if (responsible) {
      data.responsible = responsible;
      data.participants = [responsible];
    }
    if (createTaskDto.planned_date) data.planned_date = createTaskDto.planned_date;
    const task = this.tasksRepository.create(data);
    const createdTask = await this.tasksRepository.save(task);
    const createdTaskForLog = await this.tasksRepository.findOne({
      where: { id: createdTask.id },
      relations: ['project', 'responsible'],
    });

    void this.auditLogsService.record({
      actionType: AuditActionType.TASK_CREATED,
      entityType: AuditEntityType.TASK,
      entityId: createdTask.id,
      entityLabel: createdTask.title,
      actor: currentUser,
      projectId: createdTaskForLog?.project_id ?? createdTask.project_id ?? null,
      taskId: createdTask.id,
      summary: `Создана задача "${createdTask.title}"`,
      afterPayload: this.serializeTaskForAudit(createdTaskForLog ?? createdTask),
    });

    if (responsible) {
      this.notifyResponsibleAssigned({
        taskId: createdTask.id,
        taskTitle: createdTask.title ?? createTaskDto.title,
        responsibleId: responsible.id,
        actorId: currentUser?.id,
      });
    }

    this.websocketGateway.sendTaskAdded(createdTask);

    return createdTask;
  }

  private buildDuplicateTitle(title: string): string {
    const suffix = ' (копия)';
    const base = title ?? '';
    if (base.length + suffix.length <= MAX_TASK_NAME_LENGTH) return base + suffix;
    return base.slice(0, MAX_TASK_NAME_LENGTH - suffix.length) + suffix;
  }

  async duplicateTask(task_id: number, currentUser?: AuthenticatedUser) {
    const source = await this.tasksRepository.findOne({
      where: { id: task_id },
      relations: ['project', 'responsible', 'participants', 'related_tasks'],
    });

    if (!source) {
      throw new HttpException({ message: [`Задача с id=${task_id} не найдена`] }, HttpStatus.NOT_FOUND);
    }

    const isAdmin = currentUser?.role === ROLES.admin;
    if (currentUser && !isAdmin && source.project) {
      const hasAccess = await this.projectsMembersRepository.exist({
        where: {
          project: { id: source.project.id },
          user: { id: currentUser.id },
        },
      });
      if (!hasAccess) {
        throw new HttpException({ message: [`У вас нет доступа к проекту задачи id=${task_id}`] }, HttpStatus.FORBIDDEN);
      }
    }

    const last = await this.tasksRepository.findOne({
      select: ['priority'],
      order: { priority: 'DESC' },
      where: {},
    });
    const maxPriority = last?.priority ?? 0;

    const data: DeepPartial<Tasks> = {
      title: this.buildDuplicateTitle(source.title),
      status: source.status,
      priority: Number(maxPriority) + 1,
      taskType: source.taskType,
      description: source.description,
      closed_date: this.resolveClosedDate(source.status),
      planned_date: source.planned_date,
      story_points: source.story_points,
      recurrence_days: source.recurrence_days,
      recurrence_since: source.recurrence_since,
      project_id: source.project_id ?? source.project?.id ?? null,
      responsible_id: source.responsible_id ?? source.responsible?.id ?? null,
    };

    if (source.participants?.length) data.participants = source.participants;

    const task = this.tasksRepository.create(data);
    const createdTask = await this.tasksRepository.save(task);

    for (const related of source.related_tasks ?? []) {
      if (related.id === createdTask.id) continue;
      await this.linkTasks(String(createdTask.id), String(related.id));
    }

    const createdTaskForLog = await this.tasksRepository.findOne({
      where: { id: createdTask.id },
      relations: ['project', 'responsible'],
    });

    void this.auditLogsService.record({
      actionType: AuditActionType.TASK_CREATED,
      entityType: AuditEntityType.TASK,
      entityId: createdTask.id,
      entityLabel: createdTask.title,
      actor: currentUser,
      projectId: createdTaskForLog?.project_id ?? createdTask.project_id ?? null,
      taskId: createdTask.id,
      summary: `Создана задача "${createdTask.title}" (дубликат #${task_id})`,
      afterPayload: this.serializeTaskForAudit(createdTaskForLog ?? createdTask),
    });

    if (source.responsible) {
      this.notifyResponsibleAssigned({
        taskId: createdTask.id,
        taskTitle: createdTask.title,
        responsibleId: source.responsible.id,
        actorId: currentUser?.id,
      });
    }

    return currentUser ? await this.findTaskById(createdTask.id, currentUser) : createdTask;
  }

  async updateTask(taskId: string, updateTaskDto: UpdateTaskDto, currentUser?: AuthenticatedUser) {
    try {
      const existingTask = await this.tasksRepository.findOne({
        where: { id: Number(taskId) },
        relations: ['project', 'responsible'],
      });

      if (!existingTask) {
        throw new HttpException({ message: [`Задача с id=${taskId} не найдена`] }, HttpStatus.NOT_FOUND);
      }

      const data: DeepPartial<Tasks> = {};
      if (Number.isFinite(updateTaskDto.responsible_id)) {
        if (updateTaskDto.responsible_id) {
          const responsible = await this.usersRepository.findOne({
            where: { id: updateTaskDto.responsible_id },
          });
          if (!responsible) {
            throw new HttpException(
              {
                message: [`Пользователь-ответственный с id=${updateTaskDto.responsible_id} не найден`],
              },
              HttpStatus.NOT_FOUND,
            );
          }
        }
        data.responsible_id = updateTaskDto.responsible_id;
      }
      if (updateTaskDto.responsible_id === null) {
        data.responsible_id = null;
      }
      if (updateTaskDto.status) {
        data.status = updateTaskDto.status;
        data.closed_date = this.resolveClosedDate(updateTaskDto.status);
      }
      if (updateTaskDto.planned_date || updateTaskDto.planned_date === null) data.planned_date = updateTaskDto.planned_date;
      if (updateTaskDto.project_id) {
        const project = await this.projectsRepository.findOne({
          where: { id: updateTaskDto.project_id },
        });
        if (!project) {
          throw new HttpException(
            {
              message: [`Проект с id=${updateTaskDto.project_id} не найден`],
            },
            HttpStatus.NOT_FOUND,
          );
        }
        data.project_id = project.id;
      }

      if (updateTaskDto.description) data.description = updateTaskDto.description;
      if (updateTaskDto.title) data.title = updateTaskDto.title;
      if (updateTaskDto.taskType) data.taskType = updateTaskDto.taskType;
      if (updateTaskDto.story_points !== undefined) data.story_points = updateTaskDto.story_points;
      if (updateTaskDto.recurrence_days !== undefined) {
        const newDays = updateTaskDto.recurrence_days;
        data.recurrence_days = newDays;

        if (!newDays || newDays.length === 0) {
          data.recurrence_since = null;
        } else {
          const existing = await this.tasksRepository.findOne({
            where: { id: Number(taskId) },
            select: ['recurrence_days', 'recurrence_since'],
          });
          const hadRecurrence = existing?.recurrence_days && existing.recurrence_days.length > 0;
          if (!hadRecurrence) {
            data.recurrence_since = format(new Date(), 'yyyy-MM-dd');
          }
        }
      }

      const updatedTask = await this.tasksRepository.save({
        id: Number(taskId),
        ...data,
      });
      const findTask = await this.tasksRepository.findOne({
        where: { id: Number(taskId) },
        relations: ['responsible', 'participants', 'project'],
      });
      if (findTask) {
        this.websocketGateway.sendTaskUpdate(findTask);
      }

      const previousResponsibleId = existingTask.responsible?.id ?? existingTask.responsible_id ?? null;
      const assignedResponsibleId =
        typeof updateTaskDto.responsible_id === 'number' && Number.isFinite(updateTaskDto.responsible_id)
          ? updateTaskDto.responsible_id
          : null;
      if (assignedResponsibleId && assignedResponsibleId !== previousResponsibleId) {
        this.notifyResponsibleAssigned({
          taskId: Number(taskId),
          taskTitle: findTask?.title ?? existingTask.title,
          responsibleId: assignedResponsibleId,
          actorId: currentUser?.id,
        });
      }

      const beforePayload = this.serializeTaskForAudit(existingTask);
      const afterPayload = this.serializeTaskForAudit(findTask ?? updatedTask);
      const actionType =
        JSON.stringify(beforePayload.recurrence_days ?? null) !== JSON.stringify(afterPayload.recurrence_days ?? null)
          ? AuditActionType.TASK_RECURRENCE_CHANGED
          : AuditActionType.TASK_UPDATED;
      const changedFields = this.getChangedTaskAuditFields(beforePayload, afterPayload);
      const taskLabel = afterPayload.title ?? beforePayload.title ?? `#${taskId}`;

      void this.auditLogsService.record({
        actionType,
        entityType: AuditEntityType.TASK,
        entityId: taskId,
        entityLabel: taskLabel,
        actor: currentUser,
        projectId: (afterPayload.project_id as number | null | undefined) ?? null,
        taskId: Number(taskId),
        summary: this.buildTaskUpdateSummary(actionType, taskLabel, changedFields),
        beforePayload,
        afterPayload,
      });

      return findTask ?? updatedTask;
    } catch (e) {
      console.log(e);
      throw e;
    }
  }

  async deleteTask(task_id: number, currentUser?: AuthenticatedUser) {
    try {
      const existingTask = await this.tasksRepository.findOne({
        where: { id: task_id },
        relations: ['project', 'responsible'],
      });

      if (!existingTask) {
        throw new HttpException({ message: [`Задача с id=${task_id} не найдена`] }, HttpStatus.NOT_FOUND);
      }

      await this.tasksRepository.delete(task_id);
      void this.auditLogsService.record({
        actionType: AuditActionType.TASK_DELETED,
        entityType: AuditEntityType.TASK,
        entityId: task_id,
        entityLabel: existingTask.title,
        actor: currentUser,
        projectId: existingTask.project_id,
        taskId: task_id,
        summary: `Удалена задача "${existingTask.title}"`,
        beforePayload: this.serializeTaskForAudit(existingTask),
      });
      this.websocketGateway.sendTaskDeleted(task_id);
    } catch (e) {
      console.log(e);
      throw e;
    }
  }
  async updatePriorityTask(updatePriorityTaskDto: UpdatePriorityTaskDto) {
    const ids = updatePriorityTaskDto.ids;

    const [fromId, toId] = ids;
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Tasks);
      const [fromTask, toTask] = await Promise.all([repo.findOneByOrFail({ id: fromId }), repo.findOneByOrFail({ id: toId })]);
      await repo.update({ id: fromId }, { priority: -1 });
      await repo.update({ id: toId }, { priority: fromTask.priority });
      await repo.update({ id: fromId }, { priority: toTask.priority });
    });
  }

  deleteAllForTask(taskId: number) {
    return this.commentRepository.delete({ task_id: taskId });
  }

  async parseAudioToTask(file: Express.Multer.File) {
    const text = await this.deepseekService.transcribeAudio(file.buffer, file.originalname, file.mimetype);
    const taskJson = await this.deepseekService.parseTextToTaskGpt(text);
    return taskJson;
  }

  async linkTasks(baseTaskId: string, relatedTaskId: string) {
    const baseTask = await this.tasksRepository.findOne({
      where: { id: Number(baseTaskId) },
      relations: ['related_tasks'],
    });

    const relatedTask = await this.tasksRepository.findOne({
      where: { id: Number(relatedTaskId) },
      relations: ['related_tasks'],
    });

    if (!baseTask || !relatedTask) {
      throw new HttpException({ message: [`Задача с id=${baseTaskId} или ${relatedTaskId} не найдена`] }, HttpStatus.NOT_FOUND);
    }

    if (baseTask.id === relatedTask.id) {
      throw new HttpException({ message: ['Нельзя связать задачу саму с собой'] }, HttpStatus.BAD_REQUEST);
    }

    if (baseTask.related_tasks.some((t) => t.id === relatedTask.id)) {
      throw new HttpException({ message: ['Задача уже связана с этой задачей'] }, HttpStatus.BAD_REQUEST);
    }

    baseTask.related_tasks.push(relatedTask);
    relatedTask.related_tasks.push(baseTask);

    await this.tasksRepository.save(baseTask);
    await this.tasksRepository.save(relatedTask);

    return {
      id: relatedTask.id,
      title: relatedTask.title,
    };
  }

  async createAndLinkTask(baseTaskId: string, createDto: CreateAndLinkDto) {
    const baseTask = await this.tasksRepository.findOne({ where: { id: Number(baseTaskId) } });
    if (!baseTask) {
      throw new HttpException({ message: [`Задача с id=${baseTaskId} не найдена`] }, HttpStatus.NOT_FOUND);
    }
    const newTask = await this.createTask(createDto);
    await this.linkTasks(baseTaskId, newTask.id.toString());
    return newTask;
  }

  async saveUserFilterState(userId: number, filters: UpdateFilterStateDto) {
    const userFilter = await this.userTaskFilterRepository.findOne({ where: { user_id: userId } });

    const filtersToSave: Filter = {
      statuses: filters.statuses ?? [],
      projects: filters.projects ?? [],
      responsibles: filters.responsibles ?? [],
      planned_date: filters.planned_date ?? [],
      closed_date: filters.closed_date ?? [],
      taskTypes: filters.taskTypes ?? [],
      negativeFilters: filters.negativeFilters ?? {},
      title: filters.title,
    };

    if (userFilter) {
      userFilter.task_filters = filtersToSave;
      await this.userTaskFilterRepository.save(userFilter);
    } else {
      const newUserFilter = this.userTaskFilterRepository.create({
        user_id: userId,
        task_filters: filtersToSave,
      });
      await this.userTaskFilterRepository.save(newUserFilter);
    }
  }

  async getUserFilterState(userId: number) {
    const userFilter = await this.userTaskFilterRepository.findOne({ where: { user_id: userId } });

    if (!userFilter) {
      return {
        statuses: [],
        projects: [],
        responsibles: [],
        planned_date: [],
        closed_date: [],
        negativeFilters: {},
        view_type: 'list' as TaskViewType,
        collapsed_columns: [],
      };
    }

    return {
      ...userFilter.task_filters,
      view_type: userFilter.view_type,
      collapsed_columns: userFilter.collapsed_columns ?? [],
    };
  }

  async saveUserCollapsedColumns(userId: number, collapsed_columns: TASK_STATUSES[]) {
    const userFilter = await this.userTaskFilterRepository.findOne({ where: { user_id: userId } });

    if (userFilter) {
      userFilter.collapsed_columns = collapsed_columns;
      await this.userTaskFilterRepository.save(userFilter);
    } else {
      const newUserFilter = this.userTaskFilterRepository.create({
        user_id: userId,
        task_filters: {},
        collapsed_columns,
      });
      await this.userTaskFilterRepository.save(newUserFilter);
    }
  }

  async saveUserViewType(userId: number, view_type: TaskViewType) {
    const userFilter = await this.userTaskFilterRepository.findOne({ where: { user_id: userId } });

    if (userFilter) {
      userFilter.view_type = view_type;
      await this.userTaskFilterRepository.save(userFilter);
    } else {
      const newUserFilter = this.userTaskFilterRepository.create({
        user_id: userId,
        task_filters: {},
        view_type,
      });
      await this.userTaskFilterRepository.save(newUserFilter);
    }
  }

  async unlinkTasks(baseTaskId: string, relatedTaskId: number) {
    const baseTask = await this.tasksRepository.findOne({
      where: { id: Number(baseTaskId) },
      relations: ['related_tasks'],
    });

    const relatedTask = await this.tasksRepository.findOne({
      where: { id: Number(relatedTaskId) },
      relations: ['related_tasks'],
    });

    if (!baseTask || !relatedTask) {
      throw new HttpException({ message: [`Задача с id=${baseTaskId} или ${relatedTaskId} не найдена`] }, HttpStatus.NOT_FOUND);
    }

    if (baseTask.id === relatedTask.id) {
      throw new HttpException({ message: ['Нельзя отвязать задачу от самой себя'] }, HttpStatus.BAD_REQUEST);
    }

    const exists = baseTask.related_tasks.some((t) => t.id === relatedTask.id);
    if (!exists) {
      throw new HttpException({ message: ['Связи нет — отвязывать нечего'] }, HttpStatus.BAD_REQUEST);
    }

    baseTask.related_tasks = baseTask.related_tasks.filter((t) => t.id !== relatedTask.id);

    relatedTask.related_tasks = relatedTask.related_tasks.filter((t) => t.id !== baseTask.id);

    await this.tasksRepository.save(baseTask);
    await this.tasksRepository.save(relatedTask);
  }

  async exportTasksToExcel(findTasksByFilterDto: FindTasksByFilterDto, currentUser: AuthenticatedUser): Promise<Buffer> {
    const filters = await this.resolveFilters(findTasksByFilterDto, currentUser.id);
    const { projects, responsibles, statuses, existTimelog, planned_date, closed_date, year, taskTypes, title, negativeFilters } =
      filters;

    const qb = this.buildBaseQuery(currentUser, existTimelog);

    this.applyProjectsFilter(qb, projects, negativeFilters);
    this.applyResponsiblesFilter(qb, responsibles, negativeFilters);
    this.applyStatusesFilter(qb, statuses, negativeFilters);
    this.applyDateFilter(qb, 'planned_date', planned_date, negativeFilters, 'date');
    this.applyDateFilter(qb, 'closed_date', closed_date, negativeFilters, 'closed_date', findTasksByFilterDto.timezone);
    this.applyTaskTypesFilter(qb, taskTypes, negativeFilters);
    this.applyTitleFilter(qb, title);
    this.applyYearFilter(qb, year);

    qb.orderBy('task.created_at', 'DESC');

    const tasks = await qb.getMany();

    const data = tasks.map((task) => {
      const description = task.description ? extractPlainText(task.description as TiptapDoc) : '';

      return {
        ID: task.id,
        Название: task.title,
        Тип: task.taskType === TaskType.USER_STORY ? 'История' : 'Задача',
        Статус: this.getStatusLabel(task.status),
        Проект: task.project?.name || '',
        Ответственный: task.responsible ? `${task.responsible.last_name} ${task.responsible.first_name}` : '',
        Описание: description,
        Дедлайн: task.planned_date ? format(new Date(task.planned_date), 'dd.MM.yyyy') : '',
        'Дата закрытия': this.formatDatetime(task.closed_date, findTasksByFilterDto.timezone, true),
        'Дата создания': this.formatDatetime(task.created_at, findTasksByFilterDto.timezone, true),
        'Дата обновления': this.formatDatetime(task.updated_at, findTasksByFilterDto.timezone, true),
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Задачи');

    const maxWidth = 50;
    const colWidths = Object.keys(data[0] || {}).map((key) => {
      const maxLength = Math.max(key.length, ...data.map((row) => String(row[key] || '').length));
      return { wch: Math.min(maxLength + 2, maxWidth) };
    });
    worksheet['!cols'] = colWidths;

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
    return buffer;
  }

  async getWeeklyTasks(weekStart: string | undefined, currentUser: AuthenticatedUser, filtersDto: FindTasksByFilterDto = {}) {
    const monday = weekStart ? new Date(weekStart) : startOfWeek(new Date(), { weekStartsOn: 1 });
    const filters = await this.resolveFilters(filtersDto, currentUser.id);
    const { projects, responsibles, statuses, planned_date, closed_date, taskTypes, title, year, negativeFilters } = filters;
    const hasExtraTodayFilters =
      !!projects?.length ||
      !!statuses?.length ||
      !!closed_date?.length ||
      !!taskTypes?.length ||
      !!title?.trim() ||
      !!year ||
      Object.values(negativeFilters ?? {}).some(Boolean);
    const todayFilterDate =
      planned_date?.length === 2 &&
      planned_date[0] === planned_date[1] &&
      responsibles?.length === 1 &&
      responsibles[0] === currentUser.id &&
      !hasExtraTodayFilters
        ? planned_date[0]
        : null;

    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(monday, i);
      return format(date, 'yyyy-MM-dd');
    });

    const recurringQb = this.tasksRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.responsible', 'responsible')
      .leftJoinAndSelect('task.project', 'project')
      .leftJoinAndSelect('task.participants', 'participants')
      .where('task.recurrence_days IS NOT NULL');

    this.applyProjectAccessScope(recurringQb, currentUser);
    this.applyActiveProjectScope(recurringQb);
    this.applyProjectsFilter(recurringQb, projects, negativeFilters);
    this.applyResponsiblesFilter(recurringQb, responsibles, negativeFilters);
    this.applyStatusesFilter(recurringQb, statuses, negativeFilters);
    if (!todayFilterDate) {
      this.applyDateFilter(recurringQb, 'planned_date', planned_date, negativeFilters, 'date');
    }
    this.applyDateFilter(recurringQb, 'closed_date', closed_date, negativeFilters, 'closed_date', filtersDto.timezone);
    this.applyTaskTypesFilter(recurringQb, taskTypes, negativeFilters);
    this.applyTitleFilter(recurringQb, title);
    this.applyYearFilter(recurringQb, year);

    const recurringTasks = await recurringQb.getMany();

    const plannedQb = this.tasksRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.responsible', 'responsible')
      .leftJoinAndSelect('task.project', 'project')
      .leftJoinAndSelect('task.participants', 'participants')
      .where('task.recurrence_days IS NULL')
      .andWhere('DATE(task.planned_date) BETWEEN :weekStart AND :weekEnd', {
        weekStart: weekDates[0],
        weekEnd: weekDates[6],
      });

    this.applyProjectAccessScope(plannedQb, currentUser);
    this.applyActiveProjectScope(plannedQb);
    this.applyProjectsFilter(plannedQb, projects, negativeFilters);
    this.applyResponsiblesFilter(plannedQb, responsibles, negativeFilters);
    this.applyStatusesFilter(plannedQb, statuses, negativeFilters);
    this.applyDateFilter(plannedQb, 'planned_date', planned_date, negativeFilters, 'date');
    this.applyDateFilter(plannedQb, 'closed_date', closed_date, negativeFilters, 'closed_date', filtersDto.timezone);
    this.applyTaskTypesFilter(plannedQb, taskTypes, negativeFilters);
    this.applyTitleFilter(plannedQb, title);
    this.applyYearFilter(plannedQb, year);

    const plannedTasks = await plannedQb.getMany();

    const completions = await this.completionRepository
      .createQueryBuilder('c')
      .where('c.completed_at IN (:...dates)', { dates: weekDates })
      .getMany();

    const completionSet = new Set(completions.map((c) => `${c.task_id}:${String(c.completed_at).substring(0, 10)}`));

    const completionTaskIds = [...new Set(completions.map((c) => c.task_id))];
    const completionTasksMap = new Map<number, Tasks>();

    if (completionTaskIds.length) {
      const completionTasksQb = this.tasksRepository
        .createQueryBuilder('task')
        .leftJoinAndSelect('task.responsible', 'responsible')
        .leftJoinAndSelect('task.project', 'project')
        .where('task.id IN (:...ids)', { ids: completionTaskIds });
      this.applyProjectAccessScope(completionTasksQb, currentUser);
      this.applyActiveProjectScope(completionTasksQb);
      this.applyProjectsFilter(completionTasksQb, projects, negativeFilters);
      this.applyResponsiblesFilter(completionTasksQb, responsibles, negativeFilters);
      this.applyStatusesFilter(completionTasksQb, statuses, negativeFilters);
      this.applyDateFilter(completionTasksQb, 'planned_date', planned_date, negativeFilters, 'date');
      this.applyDateFilter(completionTasksQb, 'closed_date', closed_date, negativeFilters, 'closed_date', filtersDto.timezone);
      this.applyTaskTypesFilter(completionTasksQb, taskTypes, negativeFilters);
      this.applyTitleFilter(completionTasksQb, title);
      this.applyYearFilter(completionTasksQb, year);
      const fetched = await completionTasksQb.getMany();
      for (const t of fetched) completionTasksMap.set(t.id, t);
    }

    const mapCard = (task: Tasks, dateStr: string) => ({
      id: task.id,
      title: task.title,
      taskType: task.taskType,
      description: extractPlainText(task.description as TiptapDoc, 80),
      status: task.status,
      priority: task.priority,
      recurrence_days: task.recurrence_days,
      responsible: task.responsible,
      project: task.project,
      story_points: task.story_points,
      completed: completionSet.has(`${task.id}:${dateStr}`),
    });

    const getPlannedDate = (task: Tasks): string =>
      task.planned_date instanceof Date ? format(task.planned_date, 'yyyy-MM-dd') : String(task.planned_date).substring(0, 10);

    const columns = weekDates.map((dateStr, i) => {
      const dayOfWeek = (i + 1) % 7;

      const recurringCards = recurringTasks
        .filter((t) => {
          if (todayFilterDate && dateStr !== todayFilterDate) return false;
          if (!t.recurrence_days!.includes(dayOfWeek)) return false;
          if (t.recurrence_since && dateStr < String(t.recurrence_since).substring(0, 10)) return false;
          return true;
        })
        .map((t) => mapCard(t, dateStr));

      const plannedCards = plannedTasks.filter((t) => getPlannedDate(t) === dateStr).map((t) => mapCard(t, dateStr));

      const displayedCardIds = new Set([...recurringCards, ...plannedCards].map((c) => c.id));

      const orphanedCards = completions
        .filter((c) => String(c.completed_at).substring(0, 10) === dateStr && !displayedCardIds.has(c.task_id))
        .map((c) => completionTasksMap.get(c.task_id))
        .filter((t): t is Tasks => t !== undefined)
        .map((t) => mapCard(t, dateStr));

      return {
        date: dateStr,
        dayOfWeek,
        cards: [...recurringCards, ...plannedCards, ...orphanedCards],
      };
    });

    return { week_start: format(monday, 'yyyy-MM-dd'), columns };
  }

  async completeRecurringTask(taskId: number, date: string, currentUser: AuthenticatedUser) {
    const task = await this.tasksRepository.findOne({ where: { id: taskId } });
    if (!task) {
      throw new HttpException({ message: [`Задача с id=${taskId} не найдена`] }, HttpStatus.NOT_FOUND);
    }

    const existing = await this.completionRepository.findOne({
      where: { task_id: taskId, completed_at: date },
    });
    if (existing) {
      return existing;
    }

    const completion = this.completionRepository.create({
      task_id: taskId,
      user_id: currentUser.id,
      completed_at: date,
    });
    const savedCompletion = await this.completionRepository.save(completion);
    void this.auditLogsService.record({
      actionType: AuditActionType.TASK_COMPLETED,
      entityType: AuditEntityType.TASK,
      entityId: taskId,
      entityLabel: task.title,
      actor: currentUser,
      projectId: task.project_id,
      taskId,
      summary: `Отмечено выполнение повторяющейся задачи "${task.title}"`,
      afterPayload: {
        completed_at: date,
        completion_id: savedCompletion.id,
      },
    });
    return savedCompletion;
  }

  async uncompleteRecurringTask(taskId: number, date: string, currentUser: AuthenticatedUser) {
    const task = await this.tasksRepository.findOne({ where: { id: taskId } });
    if (!task) {
      throw new HttpException({ message: [`Задача с id=${taskId} не найдена`] }, HttpStatus.NOT_FOUND);
    }

    await this.completionRepository.delete({ task_id: taskId, completed_at: date });
    void this.auditLogsService.record({
      actionType: AuditActionType.TASK_UNCOMPLETED,
      entityType: AuditEntityType.TASK,
      entityId: taskId,
      entityLabel: task.title,
      actor: currentUser,
      projectId: task.project_id,
      taskId,
      summary: `Снята отметка выполнения повторяющейся задачи "${task.title}"`,
      beforePayload: {
        completed_at: date,
      },
    });
  }

  private getStatusLabel(status: TASK_STATUSES): string {
    const labels = {
      [TASK_STATUSES.open]: 'Открыта',
      [TASK_STATUSES.to_do]: 'К выполнению',
      [TASK_STATUSES.in_progress]: 'В работе',
      [TASK_STATUSES.in_review]: 'На проверке',
      [TASK_STATUSES.testing]: 'Тестирование',
      [TASK_STATUSES.ready_for_release]: 'Готово к релизу',
      [TASK_STATUSES.prod_check]: 'Проверка на проде',
      [TASK_STATUSES.control]: 'Контроль',
      [TASK_STATUSES.closed]: 'Закрыта',
    };
    return labels[status] || status;
  }

  private resolveClosedDate(status?: TASK_STATUSES): Date | null | undefined {
    if (!status) {
      return undefined;
    }

    return status === TASK_STATUSES.closed ? new Date() : null;
  }

  private serializeTaskForAudit(task: Partial<Tasks>): TaskAuditPayload {
    return {
      title: task.title ?? null,
      description: this.serializeTaskDescriptionForAudit(task.description),
      status: task.status ?? null,
      project_id: task.project_id ?? task.project?.id ?? null,
      responsible_id: task.responsible_id ?? task.responsible?.id ?? null,
      taskType: task.taskType ?? null,
      planned_date: task.planned_date ? String(task.planned_date) : null,
      story_points: task.story_points ?? null,
      recurrence_days: task.recurrence_days ?? null,
      recurrence_since: task.recurrence_since ?? null,
      closed_date: task.closed_date ? new Date(task.closed_date).toISOString() : null,
    };
  }

  private serializeTaskDescriptionForAudit(description: Tasks['description'] | null | undefined): string | null {
    if (!description) {
      return null;
    }

    const plainText = extractPlainText(description as TiptapDoc, undefined, ExtractPlainTextMode.ALL_NODES).trim();
    return plainText || null;
  }

  private getChangedTaskAuditFields(beforePayload: TaskAuditPayload, afterPayload: TaskAuditPayload): string[] {
    const fieldLabels: Array<{ key: keyof TaskAuditPayload; label: string }> = [
      { key: 'title', label: 'название' },
      { key: 'description', label: 'описание' },
      { key: 'status', label: 'статус' },
      { key: 'project_id', label: 'проект' },
      { key: 'responsible_id', label: 'ответственный' },
      { key: 'taskType', label: 'тип задачи' },
      { key: 'planned_date', label: 'плановая дата' },
      { key: 'story_points', label: 'story points' },
      { key: 'recurrence_days', label: 'дни повторения' },
      { key: 'recurrence_since', label: 'дата начала повторения' },
      { key: 'closed_date', label: 'дата закрытия' },
    ];

    return fieldLabels
      .filter(({ key }) => JSON.stringify(beforePayload[key] ?? null) !== JSON.stringify(afterPayload[key] ?? null))
      .map(({ label }) => label);
  }

  private buildTaskUpdateSummary(actionType: AuditActionType, taskLabel: string, changedFields: string[]): string {
    const baseSummary =
      actionType === AuditActionType.TASK_RECURRENCE_CHANGED
        ? `Изменена повторяемость задачи "${taskLabel}"`
        : `Обновлена задача "${taskLabel}"`;

    if (!changedFields.length) {
      return baseSummary;
    }

    return `${baseSummary} (изменено: ${changedFields.join(', ')})`;
  }
}
