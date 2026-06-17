import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique, Index } from 'typeorm';

@Unique('uq_message_user_read', ['message_id', 'user_id'])
@Index('idx_reads_user', ['user_id'])
@Index('idx_reads_message', ['message_id'])
@Entity('chat_message_reads')
export class ChatMessageRead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  message_id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  read_at: Date;
}
