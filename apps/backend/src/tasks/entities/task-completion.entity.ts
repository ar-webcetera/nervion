import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Tasks } from './task.entity';
import { Users } from '../../users/entities/users.entity';

@Entity({ name: 'task_completions' })
export class TaskCompletion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', name: 'task_id' })
  task_id: number;

  @ManyToOne(() => Tasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Tasks;

  @Column({ type: 'int', name: 'user_id' })
  user_id: number;

  @ManyToOne(() => Users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Users;

  @Column({ type: 'date', name: 'completed_at' })
  completed_at: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;
}
