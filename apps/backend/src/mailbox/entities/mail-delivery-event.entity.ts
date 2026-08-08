import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { MailDeliveryEventType } from '@tracker/contracts';
import type { JsonObject } from '@tracker/contracts';
import { MailMessages } from './mail-message.entity';

@Entity({ name: 'mail_delivery_events' })
export class MailDeliveryEvents {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int', name: 'message_id' })
  message_id: number;

  @ManyToOne(() => MailMessages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message: MailMessages;

  @Column({
    type: 'varchar',
    length: 64,
    name: 'event_type',
  })
  event_type: MailDeliveryEventType | string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, name: 'provider_event_id', nullable: true })
  provider_event_id: string | null;

  @Column({ type: 'timestamp', name: 'occurred_at' })
  occurred_at: Date;

  @Column({ type: 'jsonb', nullable: true })
  meta: JsonObject | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
