import type { User } from '~/types/user';

export interface WorkSchedule {
  id: number;
  user_id: number;
  user: User;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  hours: number;
  is_day_off: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkScheduleDto {
  user_id: number;
  work_date: string;
  start_time?: string;
  end_time?: string;
  hours?: number;
  is_day_off?: boolean;
  notes?: string;
}

export type UpdateWorkScheduleDto = Partial<CreateWorkScheduleDto>;

export interface GetWorkSchedulesParams {
  user_id?: number;
  start_date?: string;
  end_date?: string;
}
