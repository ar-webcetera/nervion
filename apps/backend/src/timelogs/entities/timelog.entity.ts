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
import { BillingReviewStatus } from '@tracker/contracts';

@Index('unique_active_timelogs_per_task_author', ['task_id', 'author_id'], {
  unique: true,
  where: `"status" = 'in_progress' AND "task_id" IS NOT NULL`,
})
@Index('unique_active_unbound_timelog_per_author', ['author_id'], {
  unique: true,
  where: `"status" = 'in_progress' AND "task_id" IS NULL`,
})
@Entity({ name: 'timelogs' })
export class Timelogs {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', name: 'task_id', nullable: true })
  task_id: number | null;

  @ManyToOne(() => Tasks, (t) => t.timelog, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'task_id' })
  task: Tasks | null;

  @Column({ type: 'varchar', nullable: true })
  title: string | null;

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

  @Column({ type: 'enum', enum: BillingReviewStatus, name: 'billing_status', nullable: true })
  billing_status: BillingReviewStatus | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'billing_rate', nullable: true })
  billing_rate: number | null;

  @Column({ type: 'date', name: 'recognized_at', nullable: true })
  recognized_at: string | null;

  @Column({ type: 'int', name: 'reviewed_by_id', nullable: true })
  reviewed_by_id: number | null;

  @Column({ type: 'timestamp', name: 'reviewed_at', nullable: true })
  reviewed_at: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;
}
