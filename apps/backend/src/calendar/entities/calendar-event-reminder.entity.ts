import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Users } from '../../users/entities/users.entity';
import { CalendarEventEntity } from './calendar-event.entity';

@Entity({ name: 'calendar_event_reminders' })
@Unique('uq_calendar_reminder_event_user', ['event_id', 'user_id'])
export class CalendarEventReminder {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  event_id: number;

  @Column({ type: 'integer' })
  user_id: number;

  @Index('idx_calendar_reminders_due')
  @Column({ type: 'timestamptz' })
  remind_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  sent_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  processing_at: Date | null;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @ManyToOne(() => CalendarEventEntity, (event) => event.reminders, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: CalendarEventEntity;

  @ManyToOne(() => Users, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Users;
}
