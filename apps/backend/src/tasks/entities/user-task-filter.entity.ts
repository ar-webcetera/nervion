import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { Users } from '../../users/entities/users.entity';
import { TASK_STATUSES } from '../../common/enums/statuses.enum';

export type TaskViewType = 'kanban' | 'list' | 'weekly';

export interface Filter {
  statuses?: TASK_STATUSES[];
  projects?: number[];
  responsibles?: number[];
  planned_date?: string[];
  closed_date?: string[];
  existTimelog?: boolean;
  year?: string;
  title?: string;
  taskTypes?: string[];
  negativeFilters?: Record<string, boolean>;
}

@Entity('user_task_filters')
export class UserTaskFilter {
  @PrimaryColumn()
  user_id: number;

  @Column({ type: 'jsonb' })
  task_filters: Filter;

  @Column({ type: 'jsonb', name: 'collapsed_columns', default: () => "'[]'" })
  collapsed_columns: TASK_STATUSES[];

  @Column({ type: 'varchar', name: 'view_type', default: 'list' })
  view_type: TaskViewType;

  @OneToOne(() => Users)
  @JoinColumn({ name: 'user_id' })
  user: Users;
}
