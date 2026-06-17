import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'push_subscriptions' })
export class PushSubscription {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('idx_push_subs_user')
  @Column({ type: 'int' })
  user_id: number;

  @Column({ type: 'text', unique: true })
  endpoint: string;

  @Column({ type: 'text' })
  p256dh: string;

  @Column({ type: 'text' })
  auth: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;
}
