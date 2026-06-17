import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Users } from '../../users/entities/users.entity';
import { Projects } from '../../projects/entities/project.entity';

@Entity({ name: 'allocations' })
export class Allocations {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', name: 'user_id', nullable: false })
  user_id: number;

  @ManyToOne(() => Users, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: Users;

  @Column({ type: 'int', name: 'project_id', nullable: false })
  project_id: number;

  @ManyToOne(() => Projects, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'project_id' })
  project: Projects;

  @Column({ type: 'date', name: 'start_date', nullable: false })
  start_date: Date;

  @Column({ type: 'date', name: 'end_date', nullable: false })
  end_date: Date;

  @Column({ type: 'time', name: 'start_time', nullable: true })
  start_time: string | null;

  @Column({ type: 'time', name: 'end_time', nullable: true })
  end_time: string | null;

  @Column({ type: 'int', default: 8, comment: 'Hours per day' })
  hours: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;
}
