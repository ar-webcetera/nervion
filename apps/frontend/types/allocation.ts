import type { User } from '~/types/user';
import type { Project } from '~/types/project';

export interface Allocation {
  id: number;
  user_id: number;
  user: User;
  project_id: number;
  project: Project;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  hours: number;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAllocationDto {
  user_id: number;
  project_id: number;
  start_date: string;
  end_date: string;
  start_time?: string;
  end_time?: string;
  hours?: number;
  notes?: string;
}

export type UpdateAllocationDto = Partial<CreateAllocationDto>;

export interface GetAllocationsParams {
  user_id?: number;
  project_id?: number;
  start_date?: string;
  end_date?: string;
}
