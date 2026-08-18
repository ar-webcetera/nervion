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
import { MailAccounts } from './mail-account.entity';
import { MailThreads } from './mail-thread.entity';

@Entity({ name: 'mail_folders' })
export class MailFolders {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', name: 'account_id' })
  account_id: number;

  @ManyToOne(() => MailAccounts, (account) => account.folders, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: MailAccounts;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @OneToMany(() => MailThreads, (thread) => thread.custom_folder)
  threads: MailThreads[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
