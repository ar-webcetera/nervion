import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn, CreateDateColumn, OneToMany } from 'typeorm';
import { ChatMessage } from './chat-message.entity';
import { ChatMember } from './chat-member.entity';

export enum ChatType {
  Direct = 'direct',
  Group = 'group',
}

@Entity({ name: 'chats' })
export class Chat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ChatType })
  type: ChatType;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @OneToMany(() => ChatMember, (m) => m.chat)
  members: ChatMember[];

  @OneToMany(() => ChatMessage, (m) => m.chat)
  messages: ChatMessage[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
