import { BillingReviewStatus } from '@tracker/contracts';
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
import { Projects } from '../../projects/entities/project.entity';
import { Tasks } from '../../tasks/entities/task.entity';

@Index(['task_id', 'occurrence_date'], { unique: true })
@Entity({ name: 'fixed_revenues' })
export class FixedRevenue {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', name: 'task_id' })
  task_id: number;

  @ManyToOne(() => Tasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Tasks;

  @Column({ type: 'int', name: 'project_id', nullable: true })
  project_id: number | null;

  @ManyToOne(() => Projects, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'project_id' })
  project: Projects | null;

  @Column({ type: 'date', name: 'occurrence_date', nullable: true })
  occurrence_date: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'timestamp', name: 'closed_at' })
  closed_at: Date;

  @Column({ type: 'date', name: 'recognized_at' })
  recognized_at: string;

  @Column({ type: 'enum', enum: BillingReviewStatus, default: BillingReviewStatus.PENDING })
  status: BillingReviewStatus;

  @Column({ type: 'int', name: 'reviewed_by_id', nullable: true })
  reviewed_by_id: number | null;

  @Column({ type: 'timestamp', name: 'reviewed_at', nullable: true })
  reviewed_at: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;
}
