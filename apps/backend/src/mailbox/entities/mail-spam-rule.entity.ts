import { MailSpamRuleScope } from '@tracker/contracts';
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { MailAccounts } from './mail-account.entity';

@Entity({ name: 'mail_spam_rules' })
export class MailSpamRules {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', name: 'account_id' })
  account_id: number;

  @ManyToOne(() => MailAccounts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: MailAccounts;

  @Column({ type: 'varchar', length: 16 })
  scope: MailSpamRuleScope;

  @Column({ type: 'varchar', length: 255 })
  value: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
