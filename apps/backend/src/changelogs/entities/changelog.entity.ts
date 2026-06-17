import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Users } from '../../users/entities/users.entity';

@Entity({ name: 'changelogs' })
export class Changelog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'jsonb', nullable: true })
  body: Record<string, any> | null;

  @Column({ type: 'boolean', default: false, name: 'is_published' })
  is_published: boolean;

  @Column({ name: 'author_id', nullable: true })
  author_id: number | null;

  @ManyToOne(() => Users, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'author_id' })
  author: Users | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;
}
