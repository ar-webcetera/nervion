import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Chat } from './chat.entity';
import { Users } from '../../users/entities/users.entity';
import { TiptapDoc } from '../../common/types/tiptap';

@Entity('chat_messages')
@Index('idx_chat_messages_chat_created', ['chat_id', 'createdAt'])
@Index('idx_chat_messages_sender', ['sender_id'])
@Index('idx_chat_messages_reply_to', ['reply_to_id'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  sender_id: string | null;

  @Column({
    type: 'jsonb',
    nullable: true,
  })
  message: TiptapDoc | null;

  @Column({ type: 'boolean', default: false })
  is_edited: boolean;

  @Column({ type: 'boolean', default: false })
  is_deleted: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reply_to_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  edited_at: Date | null;

  @Column({ type: 'uuid' })
  chat_id: string;

  @ManyToOne(() => Chat, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chat_id' })
  chat: Chat;

  @ManyToOne(() => Users, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sender_id' })
  author: Users | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
