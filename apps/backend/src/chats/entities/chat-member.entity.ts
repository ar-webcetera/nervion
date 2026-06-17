import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Chat } from './chat.entity';
import { Users } from '../../users/entities/users.entity';

export enum ChatMemberRole {
  MEMBER = 'member',
  ADMIN = 'admin',
}

@Entity('chat_members')
@Unique('uq_chat_member', ['chat_id', 'user_id'])
@Index('idx_chat_members_chat', ['chat_id'])
@Index('idx_chat_members_user', ['user_id'])
export class ChatMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  chat_id: string;

  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'varchar', length: 16, default: ChatMemberRole.MEMBER })
  role: ChatMemberRole;

  @Column({ type: 'timestamptz', nullable: true })
  left_at: Date | null;

  @ManyToOne(() => Chat, (c) => c.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chat_id' })
  chat: Chat;

  @ManyToOne(() => Users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Users;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
