import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Users } from '../../users/entities/users.entity';
import { MailThreads } from './mail-thread.entity';

export enum MAIL_ACCOUNT_TYPES {
  personal = 'personal',
  service = 'service',
}

@Entity({ name: 'mail_accounts' })
export class MailAccounts {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, unique: true })
  address: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  display_name: string | null;

  @Column({
    type: 'enum',
    enum: MAIL_ACCOUNT_TYPES,
    enumName: 'mail_account_type_enum',
    default: MAIL_ACCOUNT_TYPES.service,
  })
  type: MAIL_ACCOUNT_TYPES;

  @Column({ type: 'int', name: 'user_id', nullable: true })
  user_id: number | null;

  @ManyToOne(() => Users, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: Users | null;

  @ManyToMany(() => Users)
  @JoinTable({
    name: 'mail_account_access',
    joinColumn: { name: 'mail_account_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'user_id', referencedColumnName: 'id' },
  })
  allowedUsers: Users[];

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'text', nullable: true })
  signature_html: string | null;

  @OneToMany(() => MailThreads, (thread) => thread.account)
  threads: MailThreads[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
