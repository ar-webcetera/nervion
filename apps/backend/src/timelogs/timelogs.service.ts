import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AuditActionType,
  AuditEntityType,
  BillingReviewStatus,
  TaskBillingType,
  UNBOUND_TIMELOG_TITLE,
} from '@tracker/contracts';
import * as XLSX from 'xlsx';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, FindOptionsWhere, In, QueryFailedError, Repository } from 'typeorm';
import { Timelogs } from './entities/timelog.entity';
import { CreateTimelogDto } from './dto/create-timelog.dto';
import { Users } from '../users/entities/users.entity';
import { Tasks } from '../tasks/entities/task.entity';
import { ProjectMembers, Projects } from '../projects/entities/project.entity';
import { UpdateTimelogDto } from './dto/update-timelog.dto';
import { TIMELOG_STATUSES } from '../common/enums/statuses.enum';
import { GetTimelogByFilterDto } from './dto/get-timelog-by-filter.dto';
import { GetTimelogSummaryDto } from './dto/get-timelog-summary.dto';
import { ROLES } from '../common/enums/roles.enum';
import * as path from 'path';
import * as fs from 'fs';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class TimelogsService {
  private readonly logger = new Logger(TimelogsService.name);
  constructor(
    @InjectRepository(Timelogs)
    private readonly timelogRepository: Repository<Timelogs>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    @InjectRepository(Tasks)
    private readonly tasksRepository: Repository<Tasks>,
    @InjectRepository(ProjectMembers)
    private readonly projectMembersRepository: Repository<ProjectMembers>,
    private readonly auditLogsService: AuditLogsService,
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  async createTimelog(createTimelogDto: CreateTimelogDto, currentUser?: AuthenticatedUser) {
    const data: DeepPartial<Timelogs> = {
      change_status_at: Date.now(),
    };
    if (createTimelogDto.author_id) {
      if (currentUser && currentUser.role !== ROLES.admin && createTimelogDto.author_id !== currentUser.id) {
        throw new ForbiddenException('Нельзя создавать таймлог от имени другого пользователя');
      }
      const author = await this.usersRepository.findOneBy({ id: createTimelogDto.author_id });
      if (author) {
        data.author = author;
      } else {
        throw new HttpException(
          {
            message: [`Пользователь-автор с id=${createTimelogDto.author_id} не найден`],
          },
          HttpStatus.NOT_FOUND,
        );
      }
    }
    if (createTimelogDto.status) data.status = createTimelogDto.status;
    if (createTimelogDto.summary) data.summary = createTimelogDto.summary;
    if (createTimelogDto.time_spent) data.time_spent = createTimelogDto.time_spent * 60;
    if (createTimelogDto.tracking_date) data.tracking_date = createTimelogDto.tracking_date;
    if (createTimelogDto.task_id) {
      const task = await this.tasksRepository.findOneBy({ id: createTimelogDto.task_id });
      if (task) {
        await this.assertTaskAccess(task, currentUser);
        data.task = task;
        if (createTimelogDto.status === TIMELOG_STATUSES.completed && task.billing_type === TaskBillingType.HOURLY) {
          data.billing_status = BillingReviewStatus.PENDING;
          data.recognized_at = createTimelogDto.tracking_date ?? new Date().toISOString().slice(0, 10);
        }
      } else {
        throw new HttpException(
          {
            message: [`Задача с id=${createTimelogDto.task_id} не найден`],
          },
          HttpStatus.NOT_FOUND,
        );
      }
      data.title = null;
    } else {
      if (createTimelogDto.status === TIMELOG_STATUSES.completed) {
        throw new BadRequestException('Нельзя зафиксировать таймлог без привязки к задаче. Сначала привяжите таймер к задаче.');
      }
      const raw = createTimelogDto.title?.trim();
      data.title = raw && raw.length > 0 ? raw : UNBOUND_TIMELOG_TITLE;
    }

    let newTimelog: Timelogs;
    try {
      newTimelog = await this.timelogRepository.save(data);
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const pgCode = (error.driverError as { code?: string } | undefined)?.code;
        if (pgCode === '23505') {
          if (!createTimelogDto.task_id) {
            throw new ConflictException('У вас уже есть активный таймер без задачи. Остановите его перед запуском нового.');
          }
          throw new ConflictException('У вас уже есть активный таймер по этой задаче. Остановите его перед запуском нового.');
        }
      }
      throw error;
    }

    const createdTimelog = await this.timelogRepository.findOne({ where: { id: newTimelog.id }, relations: ['author', 'task'] });
    if (createdTimelog) {
      void this.auditLogsService.record({
        actionType: AuditActionType.TIMELOG_CREATED,
        entityType: AuditEntityType.TIMELOG,
        entityId: createdTimelog.id,
        entityLabel: createdTimelog.summary || `Таймлог #${createdTimelog.id}`,
        actor: currentUser,
        taskId: createdTimelog.task_id,
        projectId: createdTimelog.task?.project_id ?? null,
        summary: `Создан таймлог #${createdTimelog.id}`,
        afterPayload: this.serializeTimelogForAudit(createdTimelog),
      });
      this.websocketGateway.sendTimelogUpdated(createdTimelog);
    }
    return createdTimelog;
  }

  private formatTimeSpent = (time_spent: number) => {
    const hours = Math.floor(time_spent / 3600);
    const minutes = Math.floor((time_spent % 3600) / 60);
    const seconds = time_spent % 60;
    return [hours.toString().padStart(2, '0'), minutes.toString().padStart(2, '0'), seconds.toString().padStart(2, '0')].join(
      ':',
    );
  };
  async findByFilter(getTimelogByFilterDto: GetTimelogByFilterDto) {
    const { status, author_id } = getTimelogByFilterDto;
    const filter: FindOptionsWhere<Timelogs> = {};
    if (status) {
      if (Array.isArray(status)) {
        filter.status = In(status);
      } else {
        filter.status = status;
      }
    }
    if (author_id) {
      filter.author_id = author_id;
    }
    const timelogs = await this.timelogRepository.find({
      where: filter,
      relations: ['author'],
    });

    return timelogs;
  }

  async findByTask(task_id: number) {
    const timelogs = await this.timelogRepository.find({
      where: { task_id },
      relations: ['author'],
    });

    const totalSeconds = timelogs.map((log) => Number(log.time_spent)).reduce((sum, secs) => sum + secs, 0);

    const totalTimeSpent = this.formatTimeSpent(totalSeconds);

    return {
      timelogs,
      totalTimeSpent,
    };
  }

  async updateTimelog(id: number, updateTimelogDto: UpdateTimelogDto, currentUser?: AuthenticatedUser) {
    const timelog = await this.timelogRepository.findOneBy({ id });
    if (!timelog) {
      throw new HttpException(
        {
          message: [`Таймлог с id=${id} не найден`],
        },
        HttpStatus.NOT_FOUND,
      );
    }
    this.assertIsOwner(timelog, currentUser);

    const beforePayload = this.serializeTimelogForAudit(timelog);

    const isCompleted = timelog.status === TIMELOG_STATUSES.completed;

    if (updateTimelogDto.task_id !== undefined) {
      if (isCompleted) {
        throw new BadRequestException('Нельзя менять задачу у зафиксированного таймлога.');
      }
      if (updateTimelogDto.task_id === null) {
        timelog.task_id = null;
        timelog.title = timelog.title?.trim() || UNBOUND_TIMELOG_TITLE;
      } else {
        const task = await this.tasksRepository.findOneBy({ id: updateTimelogDto.task_id });
        if (!task) {
          throw new HttpException({ message: [`Задача с id=${updateTimelogDto.task_id} не найдена`] }, HttpStatus.NOT_FOUND);
        }
        await this.assertTaskAccess(task, currentUser);
        timelog.task_id = task.id;
        timelog.title = null;
      }
    }

    if (updateTimelogDto.title !== undefined && !isCompleted && timelog.task_id === null) {
      const raw = updateTimelogDto.title.trim();
      timelog.title = raw.length > 0 ? raw : UNBOUND_TIMELOG_TITLE;
    }

    if (updateTimelogDto.status === TIMELOG_STATUSES.in_progress) {
      timelog.status = TIMELOG_STATUSES.in_progress;
      timelog.change_status_at = Date.now();
    }
    if (updateTimelogDto.status === TIMELOG_STATUSES.paused) {
      timelog.status = TIMELOG_STATUSES.paused;
      const lastMs = Number(timelog.change_status_at);
      const nowMs = Date.now();
      const deltaSec = Math.floor((nowMs - lastMs) / 1000);

      timelog.time_spent = Number(timelog.time_spent) + deltaSec;
      timelog.change_status_at = Date.now();
    }

    if (updateTimelogDto.status === TIMELOG_STATUSES.completed) {
      if (!timelog.task_id) {
        throw new BadRequestException('Нельзя зафиксировать таймлог без привязки к задаче. Сначала привяжите таймер к задаче.');
      }
      timelog.status = TIMELOG_STATUSES.completed;
      timelog.summary = updateTimelogDto.summary ?? '';
      timelog.change_status_at = Date.now();
      const task = await this.tasksRepository.findOneBy({ id: timelog.task_id });
      if (task?.billing_type === TaskBillingType.HOURLY) {
        timelog.billing_status = BillingReviewStatus.PENDING;
        timelog.recognized_at = timelog.tracking_date ?? new Date().toISOString().slice(0, 10);
      }
    }

    let updatedTimelog: Timelogs;
    try {
      updatedTimelog = await this.timelogRepository.save(timelog);
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const pgCode = (error.driverError as { code?: string } | undefined)?.code;
        if (pgCode === '23505') {
          throw new ConflictException('У вас уже есть активный таймер по этой задаче. Остановите его перед запуском нового.');
        }
      }
      throw error;
    }
    const timelogWithTask = await this.timelogRepository.findOne({ where: { id }, relations: ['task'] });
    void this.auditLogsService.record({
      actionType: AuditActionType.TIMELOG_UPDATED,
      entityType: AuditEntityType.TIMELOG,
      entityId: updatedTimelog.id,
      entityLabel: updatedTimelog.summary || `Таймлог #${updatedTimelog.id}`,
      actor: currentUser,
      taskId: timelogWithTask?.task_id ?? updatedTimelog.task_id,
      projectId: timelogWithTask?.task?.project_id ?? null,
      summary: `Обновлен таймлог #${updatedTimelog.id}`,
      beforePayload,
      afterPayload: this.serializeTimelogForAudit(updatedTimelog),
    });
    this.websocketGateway.sendTimelogUpdated(updatedTimelog);
    return updatedTimelog;
  }

  /**
   * Генерирует отчет по выработке часов специалистами в формате Excel.
   *
   * Метод выполняет следующие действия:
   * 1. Агрегирует данные по затраченному времени (timelogs) для каждого специалиста за каждый день.
   * 2. Группирует результаты по ФИО и дате.
   * 3. Конвертирует суммарное время из секунд в часы.
   * 4. Создает Excel-файл с тремя колонками:
   *    - ФИО: Полное имя специалиста.
   *    - Дата: Дата учета времени.
   *    - Кол-во часов выработки: Общее количество часов, округленное до одного знака после запятой.
   * 5. Сохраняет сгенерированный отчет в директорию `reports` в корне проекта.
   *
   * @returns {Promise<Buffer>} Промис, который разрешается в Buffer с данными Excel-файла.
   */
  async getWorkHoursBySpecialistReport(): Promise<Buffer> {
    this.logger.log('Начало генерации отчета по выработке часов.');

    interface WorkHoursReportRaw {
      fullname: string;
      date: string;
      total_seconds: string;
    }

    this.logger.log('Получение данных из базы данных...');
    const results: WorkHoursReportRaw[] = await this.timelogRepository
      .createQueryBuilder('timelog')
      .leftJoin('timelog.author', 'author')
      .select([
        "author.last_name || ' ' || author.first_name || COALESCE(' ' || author.patronymic, '') as fullName",
        'DATE(timelog.created_at) as date',
        'SUM(timelog.time_spent) as total_seconds',
      ])
      .where('author.id IS NOT NULL')
      .andWhere('timelog.task_id IS NOT NULL')
      .groupBy('fullName, date')
      .orderBy('date', 'DESC')
      .getRawMany();
    this.logger.log(`Получено ${results.length} записей из БД.`);

    const reportData = results.map((result) => ({
      ФИО: result.fullname,
      Дата: result.date,
      'Кол-во часов выработки': parseFloat((Number(result.total_seconds) / 3600).toFixed(1)),
    }));

    this.logger.log('Создание Excel-файла...');
    const worksheet = XLSX.utils.json_to_sheet(reportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'WorkHoursReport');

    worksheet['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 25 }];

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const reportsDir = path.join(process.cwd(), '..', '..', 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    const filePath = path.join(reportsDir, 'work-hours-report.xlsx');
    fs.writeFileSync(filePath, buffer);
    this.logger.log(`Отчет успешно сохранен в: ${filePath}`);

    return buffer;
  }

  async deleteTimelog(id: number, currentUser?: AuthenticatedUser) {
    const timelog = await this.timelogRepository.findOne({ where: { id }, relations: ['task'] });
    if (timelog) this.assertIsOwner(timelog, currentUser);

    const result = await this.timelogRepository.delete({ id });

    if (timelog) {
      void this.auditLogsService.record({
        actionType: AuditActionType.TIMELOG_DELETED,
        entityType: AuditEntityType.TIMELOG,
        entityId: timelog.id,
        entityLabel: timelog.summary || `Таймлог #${timelog.id}`,
        actor: currentUser,
        taskId: timelog.task_id,
        projectId: timelog.task?.project_id ?? null,
        summary: `Удален таймлог #${timelog.id}`,
        beforePayload: this.serializeTimelogForAudit(timelog),
      });
    }

    return result;
  }

  async getSummary(filters: GetTimelogSummaryDto, currentUser: AuthenticatedUser) {
    const query = this.timelogRepository
      .createQueryBuilder('timelog')
      .leftJoinAndSelect('timelog.author', 'author')
      .leftJoinAndSelect('timelog.task', 'task')
      .leftJoinAndSelect('task.project', 'project')
      .where('timelog.status = :status', { status: TIMELOG_STATUSES.completed });

    if (currentUser.role !== ROLES.admin) {
      const memberships = await this.projectMembersRepository.find({
        where: { user: { id: currentUser.id } },
        select: ['id'],
        relations: ['project'],
      });
      const projectIds = memberships.map((m) => m.project.id);
      if (projectIds.length === 0) return [];
      query.andWhere('project.id IN (:...projectIds)', { projectIds });
    }

    if (filters.start_date && filters.end_date) {
      query.andWhere('timelog.created_at >= :start_date::date', { start_date: filters.start_date });
      query.andWhere("timelog.created_at < (:end_date::date + interval '1 day')", { end_date: filters.end_date });
    }

    const timelogs = await query.getMany();

    const summary: Array<{
      user_id: number;
      user: { id: number; first_name: string; last_name: string; photo_url: string | null };
      project_id: number;
      project: { id: number; name: string };
      start_date: string;
      end_date: string;
      hours: number;
    }> = [];

    const grouped = new Map<string, { user: Users; project: Projects; date: string; totalSeconds: number }>();

    timelogs.forEach((timelog) => {
      if (!timelog.task?.project || !timelog.author) return;

      const date = timelog.updated_at.toISOString().split('T')[0];
      const key = `${timelog.author.id}-${timelog.task.project.id}-${date}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          user: timelog.author,
          project: timelog.task.project,
          date,
          totalSeconds: 0,
        });
      }

      const item = grouped.get(key)!;
      const timeSpent = typeof timelog.time_spent === 'string' ? timelog.time_spent : '0';
      item.totalSeconds += parseInt(timeSpent, 10);
    });

    grouped.forEach((value) => {
      const hours = parseFloat((value.totalSeconds / 3600).toFixed(2));

      summary.push({
        user_id: value.user.id,
        user: {
          id: value.user.id,
          first_name: value.user.first_name,
          last_name: value.user.last_name,
          photo_url: value.user.photo_url,
        },
        project_id: value.project.id,
        project: {
          id: value.project.id,
          name: value.project.name,
        },
        start_date: value.date,
        end_date: value.date,
        hours,
      });
    });

    return summary;
  }

  /** Редактировать таймлог может только его автор или админ */
  private assertIsOwner(timelog: Timelogs, currentUser?: AuthenticatedUser) {
    if (!currentUser || currentUser.role === ROLES.admin) return;
    if (timelog.author_id !== currentUser.id) {
      throw new ForbiddenException('Нельзя изменять таймлог другого пользователя');
    }
  }

  /** Привязать таймлог можно только к задаче из доступного пользователю проекта */
  private async assertTaskAccess(task: Tasks, currentUser?: AuthenticatedUser) {
    if (!currentUser || currentUser.role === ROLES.admin) return;
    if (task.project_id === null) return;
    const membership = await this.projectMembersRepository.findOne({
      where: { project: { id: task.project_id }, user: { id: currentUser.id } },
      select: ['id'],
    });
    if (!membership) {
      throw new ForbiddenException('Нет доступа к проекту этой задачи');
    }
  }

  private serializeTimelogForAudit(timelog: Partial<Timelogs>) {
    return {
      author_id: timelog.author_id ?? null,
      task_id: timelog.task_id ?? null,
      title: timelog.title ?? null,
      status: timelog.status ?? null,
      time_spent: Number(timelog.time_spent ?? 0),
      summary: timelog.summary ?? null,
      tracking_date: timelog.tracking_date ?? null,
      change_status_at: timelog.change_status_at ?? null,
    };
  }
}
