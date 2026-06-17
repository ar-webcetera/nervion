import type { User } from '~/types/user';
import type { Project } from '~/types/project';
import type { JSONContent } from '@tiptap/core';
import { TASK_STATUSES, TIMELOG_STATUSES } from '@tracker/contracts';

export enum TaskType {
  USER_STORY = 'user-story',
  TASK = 'task',
}

export interface Timelog {
  id: number;
  author_id: number;
  author: User;
  task_id: number;
  tracking_date?: string | null;
  status: TIMELOG_STATUSES | TIMELOG_STATUSES[];
  time_spent: number;
  summary: null | string;
  change_status_at: number;
  authorFullName: string;
  created_at: Date;
  updated_at: Date;
}

export interface Task {
  time: number;
  id: number;
  priority: number;
  iid: string;
  title: string;
  webUrl: string;
  assigneesName: string;
  userName: string;
  projectName: string;
  project_id: number | null;
  time_spent: number;
  responsible_id: number | null;
  description: JSONContent;
  project: Project | null;
  taskType: TaskType;
  status: TASK_STATUSES;
  responsible: User | null;
  current_timelog: Timelog | null;
  isTimerRunning?: boolean;
  parent_task: Task | null;
  planned_date: Date | null | string;
  participants: User[];
  related_tasks: Task[];
  story_points: number | null;
  /** Дни недели повторения: 0=вс, 1=пн, 2=вт, 3=ср, 4=чт, 5=пт, 6=сб */
  recurrence_days: number[] | null;
  /** Выполнена ли задача сегодня (только для повторяющихся задач) */
  is_completed_today?: boolean;
  active_tracking_date?: string | null;
}

export interface WeeklyCard {
  id: number;
  title: string;
  taskType: TaskType;
  status: TASK_STATUSES;
  priority: number;
  recurrence_days: number[];
  responsible: User | null;
  project: Project | null;
  story_points: number | null;
  completed: boolean;
}

export interface WeeklyColumn {
  date: string;
  dayOfWeek: number;
  cards: WeeklyCard[];
}

export interface WeeklyTasksResponse {
  week_start: string;
  columns: WeeklyColumn[];
}

export interface TaskParams {
  issueIid?: string;
  taskType?: TaskType;
  project_id?: string;
  name?: string;
  projectPath?: string;
  timeSpent?: string;
  summary?: string;
  status?: string | string[];
}

export { TASK_STATUSES, TIMELOG_STATUSES };
