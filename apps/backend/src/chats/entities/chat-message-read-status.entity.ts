import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Unique } from 'typeorm';
import { Users } from '../../users/entities/users.entity';
import { ChatMessage } from './chat-message.entity';

@Entity('chat_message_read_status')
@Unique(['user_id', 'message_id'])
export class ChatMessageReadStatus {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  message_id: string;

  @ManyToOne(() => Users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Users;

  @ManyToOne(() => ChatMessage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message: ChatMessage;

  @CreateDateColumn({ name: 'read_at', type: 'timestamptz' })
  readAt: Date;
}
