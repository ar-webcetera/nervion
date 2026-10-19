import { CalendarParticipationStatus } from '@tracker/contracts';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Users } from '../../users/entities/users.entity';
import { CalendarEventEntity } from './calendar-event.entity';

@Entity({ name: 'calendar_event_participants' })
export class CalendarEventParticipant {
  @PrimaryColumn({ type: 'integer' })
  event_id: number;

  @PrimaryColumn({ type: 'integer' })
  user_id: number;

  @Column({
    type: 'enum',
    enum: CalendarParticipationStatus,
    enumName: 'calendar_participation_status_enum',
    default: CalendarParticipationStatus.invited,
  })
  participation_status: CalendarParticipationStatus;

  @Column({ type: 'timestamptz', nullable: true })
  responded_at: Date | null;

  @ManyToOne(() => CalendarEventEntity, (event) => event.participant_links, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: CalendarEventEntity;

  @ManyToOne(() => Users, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Users;
}
