import { Injectable } from '@nestjs/common';
import { CreateReportingDto } from './dto/create-reporting.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Timelogs } from '../timelogs/entities/timelog.entity';
import { Between, FindOptionsWhere, Repository } from 'typeorm';
import { TIMELOG_STATUSES } from '../common/enums/statuses.enum';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { Tasks } from 'src/tasks/entities/task.entity';
import * as fs from 'fs';
import { extractTextFromDoc } from '../common/utils/extractTextFromDoc';
import type { Node } from '../common/utils/extractTextFromDoc';

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

export enum TASK_STATUSES {
  open = 'open',
  to_do = 'to_do',
  in_progress = 'in_progress',
  in_review = 'in_review',
  testing = 'testing',
  ready_for_release = 'ready_for_release',
  prod_check = 'prod_check',
  control = 'control',
  closed = 'closed',
}

export const TASK_STATUS_LABELS: Record<TASK_STATUSES, string> = {
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
  ) {}
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
      created_at: Between(fromDate, toDate),
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
      const hours = +(timelog.time_spent / 3600).toFixed(2);
      const employee = createReportingDto.employees.find((e) => e.user_id === author.id);
      const rate = employee ? employee.cost : 0;
      const amount = +(hours * rate).toFixed(2);
      return {
        project: timelog.task?.project?.name || '',
        executor: `${author.first_name} ${author.last_name}`.trim(),
        specialization: '',
        grade: '',
        rate,
        taskTitle: timelog.task?.title || '',
        date: format(timelog.created_at, 'dd.MM.yyyy HH:mm'),
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
          description: task.description ? extractTextFromDoc(task.description) : '',
          status: TASK_STATUS_LABELS[task.status],
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
