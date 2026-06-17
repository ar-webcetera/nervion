import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Users } from '../../users/entities/users.entity';
import { Changelog } from './changelog.entity';

@Entity({ name: 'changelog_views' })
export class ChangelogView {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  user_id: number;

  @ManyToOne(() => Users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Users;

  @Column({ name: 'changelog_id' })
  changelog_id: number;

  @ManyToOne(() => Changelog, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'changelog_id' })
  changelog: Changelog;

  @CreateDateColumn({ name: 'viewed_at', type: 'timestamp' })
  viewed_at: Date;
}
