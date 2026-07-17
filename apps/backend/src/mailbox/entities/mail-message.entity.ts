import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Users } from '../../users/entities/users.entity';
import { MailAttachments } from './mail-attachment.entity';
import { MailThreads } from './mail-thread.entity';

export enum MAIL_DIRECTIONS {
  inbound = 'inbound',
  outbound = 'outbound',
}

export enum MAIL_MESSAGE_STATUSES {
  received = 'received',
  sent = 'sent',
  failed = 'failed',
  draft = 'draft',
}

export interface MailAddress {
  address: string;
  name?: string;
}

export interface MailAuthResults {
  spf?: string;
  dkim?: string;
  dmarc?: string;
}

@Entity({ name: 'mail_messages' })
export class MailMessages {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', name: 'thread_id' })
  thread_id: number;

  @ManyToOne(() => MailThreads, (thread) => thread.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'thread_id' })
  thread: MailThreads;

  @Column({
    type: 'enum',
    enum: MAIL_DIRECTIONS,
    enumName: 'mail_direction_enum',
  })
  direction: MAIL_DIRECTIONS;

  @Index()
  @Column({ type: 'varchar', length: 998, name: 'message_id', nullable: true })
  message_id: string | null;

  @Column({ type: 'varchar', length: 998, name: 'in_reply_to', nullable: true })
  in_reply_to: string | null;

  @Column({ type: 'text', name: 'references_header', nullable: true })
  references_header: string | null;

  @Column({ type: 'varchar', length: 255, name: 'from_address' })
  from_address: string;

  @Column({ type: 'varchar', length: 255, name: 'from_name', nullable: true })
  from_name: string | null;

  @Column({ type: 'jsonb', name: 'to_addresses', default: [] })
  to_addresses: MailAddress[];

  @Column({ type: 'jsonb', name: 'cc_addresses', default: [] })
  cc_addresses: MailAddress[];

  @Column({ type: 'varchar', length: 998, nullable: true })
  subject: string | null;

  @Column({ type: 'text', name: 'text_body', nullable: true })
  text_body: string | null;

  @Column({ type: 'text', name: 'html_body', nullable: true })
  html_body: string | null;

  @Column({ type: 'varchar', length: 1024, name: 'raw_s3_key', nullable: true })
  raw_s3_key: string | null;

  @Column({ type: 'jsonb', name: 'auth_results', nullable: true })
  auth_results: MailAuthResults | null;

  @Column({ type: 'boolean', name: 'is_read', default: false })
  is_read: boolean;

  @Column({
    type: 'enum',
    enum: MAIL_MESSAGE_STATUSES,
    enumName: 'mail_message_status_enum',
    default: MAIL_MESSAGE_STATUSES.received,
  })
  status: MAIL_MESSAGE_STATUSES;

  @Column({ type: 'int', name: 'sent_by_user_id', nullable: true })
  sent_by_user_id: number | null;

  @ManyToOne(() => Users, { nullable: true })
  @JoinColumn({ name: 'sent_by_user_id' })
  sent_by: Users | null;

  @OneToMany(() => MailAttachments, (attachment) => attachment.message)
  attachments: MailAttachments[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp', name: 'deleted_at', nullable: true })
  deleted_at: Date | null;
}
