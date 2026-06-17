import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Репозиторий, подключённый к трекеру. На этапе 1 — это указатель на git-каталог
 * на диске (bare-репа или .git существующего клона), который читаем нативным git.
 */
@Entity({ name: 'repos' })
@Index('uq_repos_project_name', ['projectId', 'name'], { unique: true })
export class Repo {
  @PrimaryGeneratedColumn()
  id: number;

  /** Проект-владелец. null — репа не привязана к проекту (видна в общем разделе). */
  @Column({ name: 'project_id', type: 'integer', nullable: true })
  projectId: number | null;

  @Column({ type: 'varchar' })
  name: string;

  /** Абсолютный путь к git-каталогу (для bare — сама репа, для клона — .../.git). */
  @Column({ name: 'gitdir', type: 'text' })
  gitdir: string;

  @Column({ name: 'default_branch', type: 'varchar', default: 'main' })
  defaultBranch: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
