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
import { MailSystemFolder } from '@tracker/contracts';
import { Tasks } from '../../tasks/entities/task.entity';
import { MailAccounts } from './mail-account.entity';
import { MailFolders } from './mail-folder.entity';
import { MailMessages } from './mail-message.entity';

export const MAIL_FOLDERS = {
  inbox: MailSystemFolder.INBOX,
  spam: MailSystemFolder.SPAM,
  trash: MailSystemFolder.TRASH,
} as const;
export type MAIL_FOLDERS = (typeof MAIL_FOLDERS)[keyof typeof MAIL_FOLDERS];

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

  @Column({ type: 'varchar', length: 255, nullable: true })
  counterparty_address: string | null;

  @Column({ type: 'timestamp', name: 'last_message_at', default: () => 'NOW()' })
  last_message_at: Date;

  @Column({ type: 'timestamp', name: 'last_inbound_at', nullable: true })
  last_inbound_at: Date | null;

  @Column({ type: 'varchar', length: 16, default: MailSystemFolder.INBOX })
  folder: MailSystemFolder;

  @Column({ type: 'int', name: 'custom_folder_id', nullable: true })
  custom_folder_id: number | null;

  @ManyToOne(() => MailFolders, (folder) => folder.threads, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'custom_folder_id' })
  custom_folder: MailFolders | null;

  @OneToMany(() => MailMessages, (message) => message.thread)
  messages: MailMessages[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
