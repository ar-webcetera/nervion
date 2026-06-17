import { Entity, Column, PrimaryGeneratedColumn, OneToMany, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from 'typeorm';
import { Tasks } from '../../tasks/entities/task.entity';
import { ProjectMembers } from '../../projects/entities/project.entity';
import { ROLES } from '../../common/enums/roles.enum';

@Entity({ name: 'users' })
export class Users {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  telegram_user_id: string;

  @Column({ type: 'varchar', length: 50, default: 'Имя' })
  first_name: string;

  @Column({ type: 'varchar', length: 50, default: 'Фамилия' })
  last_name: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  patronymic: string;

  @Column({ unique: true, nullable: true })
  email: string;

  @Column({ nullable: true })
  photo_url: string;

  @Column({ nullable: true, select: false })
  hashed_password: string;

  @Column({
    type: 'enum',
    enum: ROLES,
    enumName: 'users_role_enum',
    default: ROLES.employee,
  })
  role: ROLES;

  // Скрытые пользователем пункты бокового меню (по ключам, см. фронт MENU_ITEMS)
  @Column({ type: 'jsonb', name: 'hidden_menu_items', default: () => "'[]'" })
  hidden_menu_items?: string[];

  @OneToMany(() => ProjectMembers, (projectUser) => projectUser.user)
  project_members: ProjectMembers[];

  @OneToMany(() => Tasks, (task) => task.responsible)
  tasks_assigned: Tasks[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt: Date | null;
}
