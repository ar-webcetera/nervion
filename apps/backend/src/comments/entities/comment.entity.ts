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
import { Users } from '../../users/entities/users.entity';
import { Tasks } from '../../tasks/entities/task.entity';
@Entity({ name: 'comments' })
export class Comments {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'varchar',
    nullable: false,
  })
  @Column({
    type: 'jsonb',
    nullable: true,
    default: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '...' }],
        },
      ],
    },
  })
  message: Record<string, any> | null;

  @Column({ type: 'int', name: 'task_id', nullable: true })
  task_id: number | null;

  @Column({ type: 'boolean', default: false })
  resolved: boolean;

  @ManyToOne(() => Tasks, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'task_id' })
  task: Tasks | null;

  @ManyToOne(() => Users, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'author_id' })
  author: Users | null;

  @Column({ name: 'author_id', nullable: true })
  author_id: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;

  @Column({ type: 'int', name: 'comment_id', nullable: true })
  comment_id: number | null;

  @ManyToOne(() => Comments, (comment) => comment.subComments, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'comment_id' })
  parent: Comments | null;

  @OneToMany(() => Comments, (comment) => comment.parent)
  subComments?: Comments[];
}
