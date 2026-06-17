import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tasks } from '../../tasks/entities/task.entity';
import { MailAccounts } from './mail-account.entity';
import { MailMessages } from './mail-message.entity';

// Хранимая папка треда. Входящие/Отправленные/Черновики вычисляются по составу
// сообщений, поэтому в БД держим только то, что нельзя вывести: корзину.
export enum MAIL_FOLDERS {
  inbox = 'inbox',
  trash = 'trash',
}

@Entity({ name: 'mail_threads' })
export class MailThreads {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 998 })
  subject: string;

  @Column({ type: 'int', name: 'account_id' })
  account_id: number;

  @ManyToOne(() => MailAccounts, (account) => account.threads, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: MailAccounts;

  @Column({ type: 'int', name: 'task_id', nullable: true })
  task_id: number | null;

  @ManyToOne(() => Tasks, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'task_id' })
  task: Tasks | null;

  @Column({ type: 'int', name: 'project_id', nullable: true })
  project_id: number | null;

  // Адрес внешнего собеседника — для списка тредов без джойна сообщений
  @Column({ type: 'varchar', length: 255, nullable: true })
  counterparty_address: string | null;

  @Column({ type: 'timestamp', name: 'last_message_at', default: () => 'NOW()' })
  last_message_at: Date;

  @Column({ type: 'varchar', length: 16, default: MAIL_FOLDERS.inbox })
  folder: MAIL_FOLDERS;

  @OneToMany(() => MailMessages, (message) => message.thread)
  messages: MailMessages[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
