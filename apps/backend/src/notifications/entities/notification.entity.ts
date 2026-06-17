import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Users } from '../../users/entities/users.entity';

@Entity({ name: 'notifications' })
export class Notifications {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'varchar',
    nullable: false,
    default: '',
  })
  name: string;

  @Column({
    type: 'varchar',
    nullable: false,
    default: '',
  })
  message: string;

  @Column({
    type: 'varchar',
    nullable: false,
    default: 'Ссылка',
  })
  link: string;

  @ManyToOne(() => Users, {
    nullable: false,
  })
  @JoinColumn({ name: 'recipient_id' })
  recipient: Users;

  @Column({
    type: 'boolean',
    default: false,
  })
  is_read: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;
}
