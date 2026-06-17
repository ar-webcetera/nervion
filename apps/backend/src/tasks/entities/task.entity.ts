import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Users } from '../../users/entities/users.entity';
import { Projects } from '../../projects/entities/project.entity';
import { TASK_STATUSES } from '../../common/enums/statuses.enum';
import { Timelogs } from '../../timelogs/entities/timelog.entity';

export const MAX_TASK_NAME_LENGTH = 150;

export enum TaskType {
  USER_STORY = 'user-story',
  TASK = 'task',
}

@Index(['priority'], { unique: true })
@Check(`char_length(title) >= 3`)
@Entity({ name: 'tasks' })
export class Tasks {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'varchar',
    length: MAX_TASK_NAME_LENGTH,
    nullable: false,
    default: '',
  })
  title: string;

  @Column({ type: 'enum', enum: TaskType, default: TaskType.TASK })
  taskType: TaskType;

  @Column({ type: 'int', name: 'project_id', nullable: true })
  project_id: number | null;

  @Column({ type: 'date', name: 'planned_date', nullable: true })
  planned_date: Date | null;

  @ManyToOne(() => Projects, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'project_id' })
  project: Projects | null;

  @ManyToOne(() => Tasks, (task) => task.child_task, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'parent_task_id' })
  parent_task: Tasks | null;

  @Column({ name: 'parent_task_id', nullable: true })
  parent_task_id: number | null;

  @OneToMany(() => Tasks, (task) => task.parent_task)
  child_task: Tasks[];

  @Column({
    type: 'enum',
    enum: TASK_STATUSES,
    default: TASK_STATUSES.open,
  })
  status: TASK_STATUSES;

  @Column({
    type: 'numeric',
    default: 1,
  })
  priority: number;

  @OneToMany(() => Timelogs, (tl) => tl.task)
  timelog: Timelogs[];

  current_timelog?: Timelogs | null;

  @Column({ type: 'date', name: 'deadline_date', nullable: true })
  deadline_date: string | null;

  @Column({ type: 'time', name: 'deadline_time_from', nullable: true })
  deadline_time_from: string | null;

  @Column({ type: 'time', name: 'deadline_time_to', nullable: true })
  deadline_time_to: string | null;

  @Column({ name: 'responsible_id', nullable: true })
  responsible_id: number | null;

  @ManyToOne(() => Users, (user) => user.tasks_assigned, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'responsible_id' })
  responsible: Users | null;

  @Column({
    type: 'jsonb',
    nullable: true,
    default: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '...' }],
        },
      ],
    },
  })
  description: Record<string, any> | null;

  @ManyToMany(() => Users)
  @JoinTable({
    name: 'tasks_participants',
    joinColumn: {
      name: 'task_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'user_id',
      referencedColumnName: 'id',
    },
  })
  participants: Users[];

  @ManyToMany(() => Tasks, { cascade: false })
  @JoinTable({
    name: 'task_relations',
    joinColumn: {
      name: 'task_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'related_task_id',
      referencedColumnName: 'id',
    },
  })
  related_tasks: Tasks[];

  @Column({ type: 'int', name: 'story_points', nullable: true })
  story_points: number | null;

  @Column({ type: 'timestamp', name: 'closed_date', nullable: true })
  closed_date: Date | null;

  @Column({
    type: 'int',
    name: 'recurrence_days',
    array: true,
    nullable: true,
    default: null,
    comment: 'Дни недели повторения: 0=вс, 1=пн, 2=вт, 3=ср, 4=чт, 5=пт, 6=сб',
  })
  recurrence_days: number[] | null;

  @Column({
    type: 'date',
    name: 'recurrence_since',
    nullable: true,
    default: null,
    comment: 'Дата с которой начинаются повторения задачи',
  })
  recurrence_since: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;
}
