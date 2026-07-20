import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Users } from '../../users/entities/users.entity';
import { TIMELOG_STATUSES } from '../../common/enums/statuses.enum';
import { Tasks } from '../../tasks/entities/task.entity';

@Index('unique_active_timelogs_per_task_author', ['task_id', 'author_id'], {
  unique: true,
  where: `"status" IN ('in_progress')`,
})
@Entity({ name: 'timelogs' })
export class Timelogs {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', name: 'task_id' })
  task_id: number;

  @ManyToOne(() => Tasks, (t) => t.timelog, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Tasks;

  @Column({
    type: 'enum',
    enum: TIMELOG_STATUSES,
    default: TIMELOG_STATUSES.in_progress,
  })
  status: TIMELOG_STATUSES;

  @Column({
    type: 'numeric',
    default: 0,
  })
  time_spent: number;

  @Column({ type: 'int', name: 'author_id' })
  author_id: number;

  @ManyToOne(() => Users)
  @JoinColumn({ name: 'author_id' })
  author: Users;

  @Column({
    type: 'varchar',
    nullable: true,
  })
  summary: string;

  @Column({
    name: 'tracking_date',
    type: 'date',
    nullable: true,
    default: null,
  })
  tracking_date: string | null;

  @Column({
    name: 'change_status_at',
    type: 'bigint',
    default: 0,
  })
  change_status_at: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;
}
