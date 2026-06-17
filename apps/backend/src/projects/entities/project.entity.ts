import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Users } from '../../users/entities/users.entity';
import { ROLES } from '../../common/enums/roles.enum';
import { GRADES } from '../../common/enums/grades.enum';
import { PROJECT_STATUSES } from '../../common/enums/project-status.enum';
import type { JSONContent } from '@tiptap/core';

@Entity({ name: 'projects' })
@Unique(['name'])
export class Projects {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ type: 'jsonb', nullable: true })
  description: JSONContent;

  @Column({
    type: 'enum',
    enum: PROJECT_STATUSES,
    default: PROJECT_STATUSES.IN_PROGRESS,
  })
  status: PROJECT_STATUSES;

  @Column({ type: 'integer', default: 0 })
  budget: number;

  @Column({ type: 'integer', default: 0 })
  hourlyRate: number;

  @OneToMany(() => ProjectMembers, (pm) => pm.project, { cascade: true })
  members: ProjectMembers[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}

@Entity({ name: 'project_members' })
@Unique(['user', 'project'])
export class ProjectMembers {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Users, (user) => user.project_members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Users;

  @ManyToOne(() => Projects, (project) => project.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Projects;

  @Column({ default: ROLES.guest })
  role: ROLES;

  @Column({ default: GRADES.junior })
  grade: GRADES;

  @Column({ default: 0 })
  cost: number;
}
