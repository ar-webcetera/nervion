import { Column, Entity, PrimaryColumn } from 'typeorm';

export enum MailOutboxStatus {
  QUEUED = 'queued',
  SENDING = 'sending',
  SENT = 'sent',
  FAILED = 'failed',
  UNCERTAIN = 'uncertain',
}

@Entity({ name: 'mail_outbox' })
export class MailOutbox {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'integer' })
  message_id: number;

  @Column({ type: 'varchar', length: 16 })
  status: MailOutboxStatus;

  @Column({ type: 'timestamptz', nullable: true })
  claimed_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  last_error: string | null;
}
