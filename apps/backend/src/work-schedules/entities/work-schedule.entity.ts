import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Users } from '../../users/entities/users.entity';

@Entity({ name: 'work_schedules' })
export class WorkSchedules {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', name: 'user_id', nullable: false })
  user_id: number;

  @ManyToOne(() => Users, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Users;

  @Column({ type: 'date', name: 'work_date', nullable: false })
  work_date: string;

  @Column({ type: 'time', name: 'start_time', nullable: true })
  start_time: string | null;

  @Column({ type: 'time', name: 'end_time', nullable: true })
  end_time: string | null;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
    comment: 'Planned work hours for this slot',
    transformer: { to: (v: number) => v, from: (v: string) => parseFloat(v) },
  })
  hours: number;

  @Column({ type: 'boolean', name: 'is_day_off', default: false })
  is_day_off: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;
}
