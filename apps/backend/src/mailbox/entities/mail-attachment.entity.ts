import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { MailMessages } from './mail-message.entity';

@Entity({ name: 'mail_attachments' })
export class MailAttachments {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', name: 'message_id' })
  message_id: number;

  @ManyToOne(() => MailMessages, (message) => message.attachments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message: MailMessages;

  @Column({ type: 'varchar', length: 512 })
  filename: string;

  @Column({ type: 'varchar', length: 255, name: 'content_type' })
  content_type: string;

  @Column({ type: 'int' })
  size: number;

  @Column({ type: 'varchar', length: 1024, name: 's3_key' })
  s3_key: string;

  // Content-ID для inline-картинок в HTML письма
  @Column({ type: 'varchar', length: 255, name: 'content_id', nullable: true })
  content_id: string | null;

  @Column({ type: 'boolean', name: 'is_inline', default: false })
  is_inline: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
