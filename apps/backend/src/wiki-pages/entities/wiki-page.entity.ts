import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  RelationId,
  UpdateDateColumn,
} from 'typeorm';
import { Projects } from '../../projects/entities/project.entity';

@Entity({ name: 'wiki_pages' })
export class WikiPages {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'varchar',
    length: 80,
    nullable: false,
    default: 'Название страницы',
  })
  name: string;

  @ManyToOne(() => Projects, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'project_id' })
  project: Projects | null;

  @ManyToOne(() => WikiPages, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'parent_page_id' })
  parent_page: WikiPages | null;

  @RelationId((wp: WikiPages) => wp.parent_page)
  parent_page_id!: number;

  @Column({
    type: 'integer',
    default: 100,
  })
  priority: number;

  @Column({
    type: 'jsonb',
    nullable: true,
    default: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '' }],
        },
      ],
    },
  })
  description: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updated_at: Date;
}
