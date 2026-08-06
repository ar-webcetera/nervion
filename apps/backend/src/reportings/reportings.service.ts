import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateReportingDto } from './dto/create-reporting.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Timelogs } from '../timelogs/entities/timelog.entity';
import { Between, FindOptionsWhere, In, Repository } from 'typeorm';
import { TASK_STATUSES, TIMELOG_STATUSES } from '../common/enums/statuses.enum';
import * as XLSX from 'xlsx';
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subDays, subMonths } from 'date-fns';
import { Tasks } from 'src/tasks/entities/task.entity';
import * as fs from 'fs';
import { extractTextFromDoc } from '../common/utils/extractTextFromDoc';
import type { Node } from '../common/utils/extractTextFromDoc';
import {
  BillingQueueItem,
  BillingQueuePage,
  BillingReviewStatus,
  RevenueDashboard,
  RevenueSourceType,
  TaskBillingType,
} from '@tracker/contracts';
import { FixedRevenue } from './entities/fixed-revenue.entity';
import { MonthlyRevenueTarget } from './entities/monthly-revenue-target.entity';
import { ReviewBillingDto } from './dto/review-billing.dto';

export interface TimelogRow {
  project: string;
  executor: string;
  specialization: string;
  grade: string;
  rate: number;
  taskTitle: string;
  date: string;
  summary: string;
  hours: number;
  amount: number;
}

const TASK_STATUS_LABELS: Record<TASK_STATUSES, string> = {
  [TASK_STATUSES.open]: 'Открыто',
  [TASK_STATUSES.to_do]: 'К выполнению',
  [TASK_STATUSES.in_progress]: 'Выполняется',
  [TASK_STATUSES.in_review]: 'На ревью',
  [TASK_STATUSES.testing]: 'На тестировании',
  [TASK_STATUSES.ready_for_release]: 'Готово к релизу',
  [TASK_STATUSES.prod_check]: 'Проверка на проде',
  [TASK_STATUSES.control]: 'Контроль',
  [TASK_STATUSES.closed]: 'Закрыто',
};

const getTaskStatusLabel = (status: TASK_STATUSES): string => TASK_STATUS_LABELS[status] ?? status;

interface ReportRow {
  Проект: string;
  Исполнитель: string;
  Специализация: string;
  Грейд: string;
  'Ставка за час(руб)': number;
  'Название задачи': string;
  'Дата фиксации таймлога': string;
  'Расшифровка таймлога': string;
  'Затрачено времени, ч': number;
  Сумма: number;
}

type TaskSummaryRow = {
  Проект: string;
  Задача: string;
  Описание: string;
  Статус: string;
  Цена: number;
  'Затрачено времени, ч': number;
};

type TaskAgg = {
  projectName: string;
  taskTitle: string;
  description: string;
  status: string;
  totalHours: number;
  totalAmount: number;
};

@Injectable()
export class ReportingsService {
  constructor(
    @InjectRepository(Timelogs)
    private readonly timelogRepository: Repository<Timelogs>,
    @InjectRepository(Tasks)
    private readonly tasksRepository: Repository<Tasks>,
    @InjectRepository(FixedRevenue)
    private readonly fixedRevenueRepository: Repository<FixedRevenue>,
    @InjectRepository(MonthlyRevenueTarget)
    private readonly monthlyTargetRepository: Repository<MonthlyRevenueTarget>,
  ) {}

  async getPendingCount(): Promise<{ count: number }> {
    const [timelogs, fixed] = await Promise.all([
      this.timelogRepository.count({ where: { billing_status: BillingReviewStatus.PENDING } }),
      this.fixedRevenueRepository.count({ where: { status: BillingReviewStatus.PENDING } }),
    ]);
    return { count: timelogs + fixed };
  }

  async getBillingItems(pending: boolean, limit = 20, offset = 0): Promise<BillingQueuePage> {
    const statuses = pending ? [BillingReviewStatus.PENDING] : [BillingReviewStatus.APPROVED, BillingReviewStatus.REJECTED];
    const fetchLimit = offset + limit + 1;
    const timelogQb = this.timelogRepository
      .createQueryBuilder('timelog')
      .leftJoinAndSelect('timelog.task', 'task')
      .leftJoinAndSelect('task.project', 'project')
      .leftJoinAndSelect('timelog.author', 'author')
      .where(pending ? 'timelog.billing_status = :pending' : 'timelog.billing_status IN (:...reviewed)', {
        pending: BillingReviewStatus.PENDING,
        reviewed: [BillingReviewStatus.APPROVED, BillingReviewStatus.REJECTED],
      })
      .orderBy('timelog.updated_at', 'DESC')
      .take(fetchLimit);
    const fixedQb = this.fixedRevenueRepository
      .createQueryBuilder('revenue')
      .leftJoinAndSelect('revenue.task', 'task')
      .leftJoinAndSelect('revenue.project', 'project')
      .where(pending ? 'revenue.status = :pending' : 'revenue.status IN (:...reviewed)', {
        pending: BillingReviewStatus.PENDING,
        reviewed: [BillingReviewStatus.APPROVED, BillingReviewStatus.REJECTED],
      })
      .orderBy('revenue.closed_at', 'DESC')
      .take(fetchLimit);
    const [timelogs, fixed, timelogTotal, fixedTotal] = await Promise.all([
      timelogQb.getMany(),
      fixedQb.getMany(),
      this.timelogRepository.count({ where: { billing_status: In(statuses) } }),
      this.fixedRevenueRepository.count({ where: { status: In(statuses) } }),
    ]);
    const timelogItems: BillingQueueItem[] = timelogs.map((item) => {
      const rate = item.billing_rate == null ? Number(item.task?.project?.hourlyRate ?? 0) : Number(item.billing_rate);
      return {
        id: item.id,
        sourceType: RevenueSourceType.TIMELOG,
        status: item.billing_status!,
        project: item.task?.project?.name ?? 'Без проекта',
        task: item.task?.title ?? `Задача #${item.task_id}`,
        executor: item.author ? `${item.author.first_name} ${item.author.last_name}`.trim() : null,
        summary: item.summary,
        seconds: Number(item.time_spent),
        rate,
        amount: this.calculateTimelogAmount(item.time_spent, rate),
        occurredAt: item.updated_at.toISOString(),
        recognizedAt: item.recognized_at ?? item.tracking_date ?? format(item.updated_at, 'yyyy-MM-dd'),
      };
    });
    const fixedItems: BillingQueueItem[] = fixed.map((item) => ({
      id: item.id,
      sourceType: RevenueSourceType.FIXED_TASK,
      status: item.status,
      project: item.project?.name ?? 'Без проекта',
      task: item.task?.title ?? `Задача #${item.task_id}`,
      executor: null,
      summary: null,
      seconds: null,
      rate: null,
      amount: Number(item.amount),
      occurredAt: item.closed_at.toISOString(),
      recognizedAt: item.recognized_at,
    }));
    const total = timelogTotal + fixedTotal;
    const items = [...timelogItems, ...fixedItems]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(offset, offset + limit);
    return { items, total, hasMore: offset + items.length < total };
  }

  async reviewTimelog(id: number, dto: ReviewBillingDto, reviewerId: number): Promise<void> {
    const timelog = await this.timelogRepository.findOne({ where: { id }, relations: ['task', 'task.project'] });
    if (!timelog) throw new NotFoundException('Таймтрек не найден');
    const rate = dto.rate ?? Number(timelog.task?.project?.hourlyRate ?? 0);
    await this.timelogRepository.update(id, {
      billing_status: dto.status,
      billing_rate: dto.status === BillingReviewStatus.APPROVED ? rate : null,
      recognized_at: dto.recognizedAt,
      reviewed_by_id: reviewerId,
      reviewed_at: new Date(),
    });
  }

  async reviewFixedRevenue(id: number, dto: ReviewBillingDto, reviewerId: number): Promise<void> {
    const revenue = await this.fixedRevenueRepository.findOneBy({ id });
    if (!revenue) throw new NotFoundException('Начисление не найдено');
    await this.fixedRevenueRepository.update(id, {
      status: dto.status,
      amount: dto.amount ?? revenue.amount,
      recognized_at: dto.recognizedAt,
      reviewed_by_id: reviewerId,
      reviewed_at: new Date(),
    });
  }

  async upsertMonthlyTarget(year: number, month: number, amount: number, userId: number): Promise<void> {
    const existing = await this.monthlyTargetRepository.findOneBy({ year, month });
    await this.monthlyTargetRepository.save({ ...(existing ?? {}), year, month, amount, updated_by_id: userId });
  }

  async getRevenueDashboard(now = new Date()): Promise<RevenueDashboard> {
    const currentStart = format(startOfMonth(now), 'yyyy-MM-dd');
    const currentEnd = format(endOfMonth(now), 'yyyy-MM-dd');
    const previous = subMonths(now, 1);
    const [timelogs, fixed, openFixed, target] = await Promise.all([
      this.timelogRepository.find({
        where: { billing_status: In([BillingReviewStatus.APPROVED, BillingReviewStatus.PENDING]) },
        relations: ['task', 'task.project'],
      }),
      this.fixedRevenueRepository.find({
        where: { status: In([BillingReviewStatus.APPROVED, BillingReviewStatus.PENDING]) },
        relations: ['task', 'project'],
      }),
      this.tasksRepository
        .createQueryBuilder('task')
        .leftJoinAndSelect('task.project', 'project')
        .where('task.billing_type = :type', { type: TaskBillingType.FIXED })
        .andWhere('task.status != :closed', { closed: TASK_STATUSES.closed })
        .getMany(),
      this.monthlyTargetRepository.findOneBy({ year: now.getFullYear(), month: now.getMonth() + 1 }),
    ]);
    type Entry = { date: string; amount: number; project: string; status: BillingReviewStatus };
    const entries: Entry[] = [
      ...timelogs.map((item) => ({
        date: item.recognized_at ?? item.tracking_date ?? format(item.updated_at, 'yyyy-MM-dd'),
        amount: this.calculateTimelogAmount(item.time_spent, Number(item.billing_rate ?? item.task?.project?.hourlyRate ?? 0)),
        project: item.task?.project?.name ?? 'Без проекта',
        status: item.billing_status!,
      })),
      ...fixed.map((item) => ({
        date: item.recognized_at,
        amount: Number(item.amount),
        project: item.project?.name ?? 'Без проекта',
        status: item.status,
      })),
    ];
    const approved = entries.filter((item) => item.status === BillingReviewStatus.APPROVED);
    const sumPeriod = (from: string, to: string) =>
      approved.filter((item) => item.date >= from && item.date <= to).reduce((sum, item) => sum + item.amount, 0);
    const today = format(now, 'yyyy-MM-dd');
    const yesterday = format(subDays(now, 1), 'yyyy-MM-dd');
    const weekStart = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const weekEnd = format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const previousStart = format(startOfMonth(previous), 'yyyy-MM-dd');
    const previousEnd = format(endOfMonth(previous), 'yyyy-MM-dd');
    const currentEntries = approved.filter((item) => item.date >= currentStart && item.date <= currentEnd);
    const aggregate = (items: Entry[], key: (item: Entry) => string) => {
      const values = new Map<string, number>();
      items.forEach((item) => values.set(key(item), (values.get(key(item)) ?? 0) + item.amount));
      return [...values.entries()].map(([label, amount]) => ({ label, amount: this.roundMoney(amount) }));
    };
    const actual = currentEntries.reduce((sum, item) => sum + item.amount, 0);
    const pending = entries
      .filter((item) => item.status === BillingReviewStatus.PENDING && item.date >= currentStart && item.date <= currentEnd)
      .reduce((sum, item) => sum + item.amount, 0);
    const openFixedAmount = openFixed.reduce((sum, task) => sum + Number(task.fixed_price ?? 0), 0);
    return {
      summary: [
        { key: 'today', label: 'Сегодня', amount: this.roundMoney(sumPeriod(today, today)) },
        { key: 'yesterday', label: 'Вчера', amount: this.roundMoney(sumPeriod(yesterday, yesterday)) },
        { key: 'currentWeek', label: 'Текущая неделя', amount: this.roundMoney(sumPeriod(weekStart, weekEnd)) },
        { key: 'currentMonth', label: 'Текущий месяц', amount: this.roundMoney(actual) },
        { key: 'previousMonth', label: 'Предыдущий месяц', amount: this.roundMoney(sumPeriod(previousStart, previousEnd)) },
      ],
      daily: aggregate(currentEntries, (item) => item.date).sort((a, b) => a.label.localeCompare(b.label)),
      projects: aggregate(currentEntries, (item) => item.project).sort((a, b) => b.amount - a.amount),
      actual: this.roundMoney(actual),
      pending: this.roundMoney(pending),
      openFixed: this.roundMoney(openFixedAmount),
      potential: this.roundMoney(actual + pending + openFixedAmount),
      target: Number(target?.amount ?? 0),
    };
  }

  private calculateTimelogAmount(seconds: number, rate: number): number {
    return this.roundMoney((Number(seconds) / 3600) * Number(rate));
  }

  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
  private async buildTimelogs(
    createReportingDto: CreateReportingDto,
  ): Promise<{ timelogs: TimelogRow[]; rawTimelogs: Timelogs[]; rateByUserId: Map<number, number> }> {
    const { from, to, project_id, executor_id } = createReportingDto;
    const rateByUserId = new Map<number, number>();
    for (const e of createReportingDto.employees ?? []) {
      rateByUserId.set(e.user_id, Number(e.cost) || 0);
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    fromDate.setUTCHours(0, 0, 0, 0);
    toDate.setUTCDate(toDate.getUTCDate() + 1);
    toDate.setUTCHours(0, 0, 0, 0);

    const where: FindOptionsWhere<Timelogs> = {
      updated_at: Between(fromDate, toDate),
      status: TIMELOG_STATUSES.completed,
      task: {},
    };
    if (project_id) {
      where.task = { project: { id: project_id } };
    }
    if (executor_id) {
      where.author_id = executor_id;
    }

    const rawTimelogs = await this.timelogRepository.find({
      where,
      relations: ['task', 'author', 'task.project'],
    });

    const timelogs: TimelogRow[] = rawTimelogs.map((timelog) => {
      const author = timelog.author;
      const hours = +(Number(timelog.time_spent) / 3600).toFixed(2);
      const employee = author ? createReportingDto.employees.find((e) => e.user_id === author.id) : undefined;
      const rate = employee ? employee.cost : 0;
      const amount = +(hours * rate).toFixed(2);
      const loggedAt = this.resolveTimelogLoggedAt(timelog);
      const executorName = author ? `${author.first_name} ${author.last_name}`.trim() : `Пользователь #${timelog.author_id}`;

      return {
        project: timelog.task?.project?.name || '',
        executor: executorName,
        specialization: '',
        grade: '',
        rate,
        taskTitle: timelog.task?.title || '',
        date: format(loggedAt, 'dd.MM.yyyy HH:mm'),
        summary: timelog.summary,
        hours,
        amount,
      };
    });

    return { timelogs, rawTimelogs, rateByUserId };
  }

  async preview(createReportingDto: CreateReportingDto): Promise<TimelogRow[]> {
    const { timelogs } = await this.buildTimelogs(createReportingDto);
    return timelogs;
  }

  async create(createReportingDto: CreateReportingDto) {
    const { timelogs, rawTimelogs, rateByUserId } = await this.buildTimelogs(createReportingDto);

    const rows: ReportRow[] = timelogs.map((t) => ({
      Проект: t.project,
      Исполнитель: t.executor,
      Специализация: t.specialization,
      Грейд: t.grade,
      'Ставка за час(руб)': t.rate,
      'Название задачи': t.taskTitle,
      'Дата фиксации таймлога': t.date,
      'Расшифровка таймлога': t.summary,
      'Затрачено времени, ч': t.hours,
      Сумма: t.amount,
    }));

    const aggByTask = new Map<number, TaskAgg>();

    for (const timelog of rawTimelogs) {
      const task = timelog.task;
      if (!task || !task.id) continue;

      const key = task.id;
      const hours = +(Number(timelog.time_spent || 0) / 3600).toFixed(2);
      const rate = rateByUserId.get(timelog.author_id ?? 0) ?? 0;
      const amount = +(hours * rate).toFixed(2);

      const cur = aggByTask.get(key);
      if (cur) {
        cur.totalHours = +(cur.totalHours + hours).toFixed(2);
        cur.totalAmount = +(cur.totalAmount + amount).toFixed(2);
      } else {
        aggByTask.set(key, {
          projectName: task.project?.name ?? '',
          taskTitle: task.title ?? '',
          description: this.extractTaskDescription(task.description),
          status: getTaskStatusLabel(task.status),
          totalHours: hours,
          totalAmount: amount,
        });
      }
    }

    const taskSummaryRows: TaskSummaryRow[] = Array.from(aggByTask.values()).map((agg) => ({
      Проект: agg.projectName,
      Задача: agg.taskTitle,
      Описание: agg.description,
      Статус: agg.status,
      Цена: agg.totalAmount,
      'Затрачено времени, ч': agg.totalHours,
    }));

    const workbook: XLSX.WorkBook = XLSX.utils.book_new();

    const worksheet: XLSX.WorkSheet = XLSX.utils.json_to_sheet(rows, {
      header: [
        'Проект',
        'Исполнитель',
        'Специализация',
        'Грейд',
        'Ставка за час(руб)',
        'Название задачи',
        'Дата фиксации таймлога',
        'Расшифровка таймлога',
        'Затрачено времени, ч',
        'Сумма',
      ],
    });

    const worksheet2: XLSX.WorkSheet = XLSX.utils.json_to_sheet(taskSummaryRows, {
      header: ['Проект', 'Задача', 'Описание', 'Статус', 'Цена', 'Затрачено времени, ч'],
    });

    XLSX.utils.book_append_sheet(workbook, worksheet2, 'Сводка по задачам');
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Таймтрекинг');

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
    return buffer;
  }

  private resolveTimelogLoggedAt(timelog: Timelogs): Date {
    if (timelog.tracking_date) {
      const trackingDate = new Date(`${timelog.tracking_date}T12:00:00`);
      if (!Number.isNaN(trackingDate.getTime())) {
        return trackingDate;
      }
    }

    return timelog.updated_at;
  }

  private extractTaskDescription(description: Tasks['description']): string {
    if (!description) return '';

    try {
      return extractTextFromDoc(description).slice(0, 32_000);
    } catch {
      return '';
    }
  }
  async syncProjectTasksToTable(projectId: number) {
    const workbook = XLSX.utils.book_new();

    const tasks = await this.tasksRepository.find({ where: { project_id: projectId } });

    const rows = tasks.map((task) => ({
      'Название задачи': task.title ?? '',
      'Описание задачи': extractTextFromDoc(task.description as { content?: Node[] } | Node),
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: ['Название задачи', 'Описание задачи'],
    });

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Задачи');

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    fs.writeFileSync('tasks.xlsx', buffer);
    return buffer;
  }
}
