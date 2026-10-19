import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Users } from '../../users/entities/users.entity';
import { CalendarEventParticipant } from './calendar-event-participant.entity';
import { CalendarEventReminder } from './calendar-event-reminder.entity';

@Entity({ name: 'calendar_events' })
export class CalendarEventEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'timestamptz' })
  start_at: Date;

  @Column({ type: 'timestamptz' })
  end_at: Date;

  @Column({ type: 'varchar', length: 100, default: 'Europe/Moscow' })
  timezone: string;

  @Column({ type: 'integer', default: 15 })
  reminder_minutes: number;

  @Column({ type: 'integer' })
  creator_id: number;

  @ManyToOne(() => Users, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'creator_id' })
  creator: Users;

  @OneToMany(() => CalendarEventParticipant, (participant) => participant.event)
  participant_links: CalendarEventParticipant[];

  @OneToMany(() => CalendarEventReminder, (reminder) => reminder.event)
  reminders: CalendarEventReminder[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
