import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Users } from '../../users/entities/users.entity';
import { Projects } from '../../projects/entities/project.entity';

@Entity('quick_links')
export class QuickLink {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'int' })
  user_id: number;

  @ManyToOne(() => Users)
  @JoinColumn({ name: 'user_id' })
  user: Users;

  @Column({ type: 'int' })
  project_id: number;

  @ManyToOne(() => Projects)
  @JoinColumn({ name: 'project_id' })
  project: Projects;

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
