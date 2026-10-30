import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { execFile } from 'child_process';
import { Repo } from './entities/repo.entity';
import { CreateRepoDto } from './dto/create-repo.dto';
import { GitRepoListItem, toGitRepoListItem } from './git-clone-url.util';
import { Projects } from '../projects/entities/project.entity';
import { requireTenantContext } from '../tenancy/tenant-context.service';
import { TenantJobsService } from '../tenancy/tenant-jobs.service';
import {
  assertTenantGitDirectory,
  createTenantGitCopy,
  readGitConnection,
  removeTenantGitCopy,
  validateGitRemote,
} from './git-tenant-storage';
import { executeGit } from './git-runtime';
import { GitRepositoryAvailability, GitRepositoryMode } from '@tracker/contracts';
import { assertNoExternalGitCleanup, resolveExternalGitRepository } from './git-external-readonly';

/** Хеш пустого дерева git — база для диффа первого коммита (у него нет родителя). */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
/** Разделитель полей в --format (US, 0x1f) — не встречается в тексте git-метаданных. */
const FS = '\x1f';
/** Лимиты на git-процесс: до 64 МБ вывода и 20 секунд. */
const MAX_BUFFER = 64 * 1024 * 1024;
const GIT_TIMEOUT = 20_000;
/** Файлы крупнее не отдаём содержимым (только мета) — защита от тяжёлых блобов. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface BranchInfo {
  name: string;
  sha: string;
  lastCommitDate: string;
  isDefault: boolean;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  subject: string;
}

export interface TreeEntry {
  type: 'tree' | 'blob' | 'commit';
  mode: string;
  oid: string;
  size: number | null;
  name: string;
  path: string;
}

export interface FileContent {
  path: string;
  ref: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  content: string | null;
}

export type DiffLineType = 'add' | 'del' | 'ctx';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string | null;
  newPath: string | null;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffResult {
  files: DiffFile[];
  fileCount: number;
}

@Injectable()
export class GitService implements OnModuleInit {
  constructor(
    @InjectRepository(Repo)
    private readonly reposRepo: Repository<Repo>,
    @InjectRepository(Projects)
    private readonly projectsRepo: Repository<Projects>,
    private readonly tenantJobs: TenantJobsService,
  ) {}

  onModuleInit(): void {
    if (!this.isTenantMode()) return;
    this.tenantJobs.register('git.cleanup', async (job) => {
      const context = requireTenantContext();
      const gitdir = job.payload.gitdir;
      if (typeof gitdir !== 'string' || job.tenant_id !== context.tenant.id) throw new Error('Invalid Git cleanup context');
      assertNoExternalGitCleanup(gitdir);
      if (await this.reposRepo.existsBy({ gitdir })) return;
      await removeTenantGitCopy(context.tenant.id, gitdir);
    });
  }

  private isTenantMode(): boolean {
    return process.env.TENANCY_ENABLED === 'true';
  }

  private assertFeature(): void {
    if (this.isTenantMode() && requireTenantContext().tenant.featureFlags.git !== true) {
      throw new ForbiddenException('Git отключен для пространства');
    }
  }

  private async assertWritable(): Promise<void> {
    this.assertFeature();
    if (!this.isTenantMode()) return;
    const context = requireTenantContext();
    if (context.tenant.readOnly) throw new ForbiddenException('Пространство доступно только для чтения');
    const rows = await context.manager.query<Array<{ acquired: boolean }>>(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
      [`${context.tenant.id}:git`],
    );
    if (!rows[0]?.acquired) throw new ConflictException('Операция Git уже выполняется. Повторите позже');
  }

  private async publicRepo(repo: Repo): Promise<GitRepoListItem> {
    if (!this.isTenantMode()) return toGitRepoListItem(repo);
    const tenant = requireTenantContext().tenant;
    const tenantId = tenant.id;
    const external = resolveExternalGitRepository(tenantId, repo.id, repo.gitdir);
    let available = false;
    let cloneUrl: string | null = null;
    if (external) {
      available = await external.available();
      cloneUrl = available ? external.cloneUrl : null;
    } else {
      try {
        const connection = await readGitConnection(tenantId, repo.gitdir);
        available = true;
        cloneUrl = connection.remoteUrl;
      } catch {
        // An unavailable repository must not hide all other repository metadata.
      }
    }
    return {
      id: repo.id,
      projectId: repo.projectId,
      name: repo.name,
      defaultBranch: repo.defaultBranch,
      cloneUrl,
      mode: external ? GitRepositoryMode.EXTERNAL_READ_ONLY : GitRepositoryMode.MANAGED,
      availability: available ? GitRepositoryAvailability.AVAILABLE : GitRepositoryAvailability.UNAVAILABLE,
      capabilities: {
        canRead: available,
        canFetch: available && !external && cloneUrl !== null && !tenant.readOnly,
        canDelete: available && !external && !tenant.readOnly,
      },
    };
  }

  private async scheduleCleanup(gitdir: string): Promise<void> {
    assertNoExternalGitCleanup(gitdir);
    const idempotencyKey = `git.cleanup:${gitdir.split('/').slice(-2, -1)[0]}`;
    await this.tenantJobs.enqueue('git.cleanup', idempotencyKey, { gitdir });
    // Readers holding an older MVCC snapshot may still use the previous copy.
    await requireTenantContext().manager.query(
      "UPDATE tenant_jobs SET available_at = now() + interval '2 minutes' WHERE idempotency_key = $1 AND status = 'pending'",
      [idempotencyKey],
    );
  }

  // ---------------------------------------------------------------- репозитории

  async listRepos(userId: number, projectId?: number): Promise<GitRepoListItem[]> {
    this.assertFeature();
    if (projectId) await this.assertProjectAccess(projectId, userId);

    const query = this.reposRepo
      .createQueryBuilder('repo')
      .leftJoin(Projects, 'project', 'project.id = repo.projectId')
      .where('(repo.projectId IS NULL OR project.isPrivate = false OR project.ownerId = :userId)', { userId })
      .orderBy('repo.name', 'ASC');
    if (projectId) query.andWhere('repo.projectId = :projectId', { projectId });

    const repositories = await query.getMany();
    const result: GitRepoListItem[] = [];
    // Bound filesystem inspection across external repositories. Preserve ordering.
    for (let offset = 0; offset < repositories.length; offset += 4) {
      result.push(...(await Promise.all(repositories.slice(offset, offset + 4).map((repo) => this.publicRepo(repo)))));
    }
    return result;
  }

  /** Подключить существующий git-каталог (bare-репа или .../.git) как репозиторий трекера. */
  async createRepo(dto: CreateRepoDto, userId: number): Promise<GitRepoListItem> {
    if (!dto.name.trim()) throw new BadRequestException('Укажите название репозитория');
    if (dto.defaultBranch?.trim()) this.assertRef(dto.defaultBranch);
    await this.assertWritable();
    if (dto.projectId) await this.assertProjectAccess(dto.projectId, userId);
    let gitdir: string;
    if (this.isTenantMode()) {
      if (dto.gitdir || !dto.remoteUrl)
        throw new BadRequestException('В облачной версии нужен HTTPS-адрес репозитория, а не путь на сервере');
      const context = requireTenantContext();
      const maxRepos = Number(process.env.GIT_MAX_REPOS_PER_TENANT || 25);
      if (!Number.isSafeInteger(maxRepos) || maxRepos < 1 || maxRepos > 1000)
        throw new BadRequestException('Некорректный лимит репозиториев');
      if ((await this.reposRepo.count()) >= maxRepos) throw new BadRequestException('Достигнут лимит репозиториев пространства');
      const connection = {
        remoteUrl: validateGitRemote(dto.remoteUrl).href,
        username: dto.username?.trim() || '',
        token: dto.token || '',
      };
      gitdir = await createTenantGitCopy(context.tenant.id, connection, undefined, false, (allocated) => {
        requireTenantContext();
        context.afterRollback.push(() => removeTenantGitCopy(context.tenant.id, allocated));
      });
      requireTenantContext();
    } else {
      if (!dto.gitdir || dto.remoteUrl || dto.token || dto.username) throw new BadRequestException('Укажите путь к git-каталогу');
      gitdir = dto.gitdir.trim();
    }
    if (!gitdir.startsWith('/')) {
      throw new BadRequestException('Путь должен быть абсолютным');
    }
    try {
      await this.execGitText(gitdir, ['rev-parse', '--git-dir']);
    } catch {
      throw new BadRequestException('По указанному пути нет git-репозитория');
    }

    let defaultBranch = dto.defaultBranch?.trim() ?? '';
    if (!defaultBranch) {
      try {
        defaultBranch = (await this.execGitText(gitdir, ['symbolic-ref', '--short', 'HEAD'])).trim();
      } catch {
        defaultBranch = '';
      }
    }
    if (!defaultBranch) {
      try {
        defaultBranch = (
          await this.execGitText(gitdir, ['for-each-ref', '--count=1', '--format=%(refname:short)', 'refs/heads'])
        ).trim();
      } catch {
        defaultBranch = '';
      }
    }

    const repo = this.reposRepo.create({
      name: dto.name.trim(),
      gitdir,
      defaultBranch: defaultBranch || 'main',
      projectId: dto.projectId ?? null,
    });

    try {
      const saved = await this.reposRepo.save(repo);
      return this.publicRepo(saved);
    } catch (e) {
      const code =
        (e as { code?: string; driverError?: { code?: string } })?.code ??
        (e as { driverError?: { code?: string } })?.driverError?.code;
      if (code === '23505') {
        throw new BadRequestException('Репозиторий с таким именем уже подключён');
      }
      throw e;
    }
  }

  async deleteRepo(id: number, userId: number): Promise<void> {
    await this.assertWritable();
    const repo = await this.getRepoOrThrow(id, userId, false);
    await this.assertMutableRepository(repo);
    await this.reposRepo.remove(repo);
    if (this.isTenantMode()) await this.scheduleCleanup(repo.gitdir);
  }

  async fetchRepo(id: number, userId: number): Promise<GitRepoListItem> {
    await this.assertWritable();
    if (!this.isTenantMode()) throw new BadRequestException('Обновление источника через API доступно только для пространств');
    const repo = await this.getRepoOrThrow(id, userId, false);
    await this.assertMutableRepository(repo);
    const context = requireTenantContext();
    const previous = repo.gitdir;
    const connection = await readGitConnection(context.tenant.id, previous);
    if (!connection.remoteUrl)
      throw new BadRequestException('Подключите удаленный источник заново для обновления импортированной копии');
    const gitdir = await createTenantGitCopy(context.tenant.id, connection, previous, true, (allocated) => {
      requireTenantContext();
      context.afterRollback.push(() => removeTenantGitCopy(context.tenant.id, allocated));
    });
    requireTenantContext();
    repo.gitdir = gitdir;
    await this.reposRepo.save(repo);
    await this.scheduleCleanup(previous);
    return this.publicRepo(repo);
  }

  /**
   * Первичные данные раздела одним запросом: список репозиториев + ветки/коммиты/дерево
   * первого репо. Весь каскад выполняется на бэке (git локальный, быстрый), поэтому
   * SSR делает один надёжный fetch и состояние не приходит частичным.
   */
  async getInitial(
    userId: number,
    projectId?: number,
    repoId?: number,
    branchName?: string,
    commit?: string,
    file?: string,
  ): Promise<{
    repos: GitRepoListItem[];
    repoId: number | null;
    branch: string;
    branches: BranchInfo[];
    commits: CommitInfo[];
    tree: TreeEntry[];
    detail: { kind: 'diff'; commit: CommitInfo; data: DiffResult } | { kind: 'file'; entry: TreeEntry; data: FileContent } | null;
  }> {
    const reposList = await this.listRepos(userId, projectId);
    if (!reposList.length) {
      return { repos: [], repoId: null, branch: '', branches: [], commits: [], tree: [], detail: null };
    }
    const selected =
      (repoId != null ? reposList.find((r) => r.id === repoId) : undefined) ??
      reposList.find((repo) => repo.capabilities.canRead) ??
      reposList[0];
    if (!selected.capabilities.canRead) {
      return { repos: reposList, repoId: selected.id, branch: '', branches: [], commits: [], tree: [], detail: null };
    }
    const branchList = await this.branches(selected.id, userId);
    const wanted = branchName && branchList.some((b) => b.name === branchName) ? branchName : undefined;
    const branch = wanted ?? (branchList.find((b) => b.isDefault) ?? branchList[0])?.name ?? '';
    let commitList: CommitInfo[] = [];
    let treeList: TreeEntry[] = [];
    if (branch) {
      [commitList, treeList] = await Promise.all([
        this.commits(selected.id, branch, 1, 30, userId),
        this.tree(selected.id, branch, '', userId),
      ]);
    }

    let detail:
      | { kind: 'diff'; commit: CommitInfo; data: DiffResult }
      | { kind: 'file'; entry: TreeEntry; data: FileContent }
      | null = null;
    try {
      if (commit) {
        const data = await this.diffCommit(selected.id, commit, userId);
        const c = commitList.find((x) => x.hash === commit) ?? {
          hash: commit,
          shortHash: commit.slice(0, 8),
          authorName: '',
          authorEmail: '',
          date: '',
          subject: commit.slice(0, 8),
        };
        detail = { kind: 'diff', commit: c, data };
      } else if (branch && file) {
        const data = await this.file(selected.id, branch, file, userId);
        detail = {
          kind: 'file',
          entry: { type: 'blob', mode: '', oid: '', size: data.size, name: file.split('/').pop() ?? file, path: file },
          data,
        };
      }
    } catch {
      detail = null;
    }

    return {
      repos: reposList,
      repoId: selected.id,
      branch,
      branches: branchList,
      commits: commitList,
      tree: treeList,
      detail,
    };
  }

  private async assertProjectAccess(projectId: number, userId: number): Promise<void> {
    const project = await this.projectsRepo.findOne({ where: { id: projectId } });
    if (!project || (project.isPrivate && project.ownerId !== userId)) {
      throw new NotFoundException('Проект не найден');
    }
  }

  private async getRepoOrThrow(repoId: number, userId: number, requireReadable = true): Promise<Repo> {
    this.assertFeature();
    const repo = await this.reposRepo.findOne({ where: { id: repoId } });
    if (!repo) throw new NotFoundException('Репозиторий не найден');
    if (repo.projectId) await this.assertProjectAccess(repo.projectId, userId);
    if (this.isTenantMode() && requireReadable) {
      const tenantId = requireTenantContext().tenant.id;
      if (!resolveExternalGitRepository(tenantId, repo.id, repo.gitdir)) await assertTenantGitDirectory(tenantId, repo.gitdir);
    }
    return repo;
  }

  private async assertMutableRepository(repo: Repo): Promise<void> {
    if (!this.isTenantMode()) return;
    assertNoExternalGitCleanup(repo.gitdir);
    await assertTenantGitDirectory(requireTenantContext().tenant.id, repo.gitdir);
  }

  // ------------------------------------------------------------ низкоуровневый git

  /**
   * Безопасный вызов git: аргументы передаём массивом (без shell), поэтому
   * инъекции невозможны. ref/path дополнительно валидируем, пути ставим после '--'.
   */
  private execGitText(gitdir: string, args: string[]): Promise<string> {
    if (this.isTenantMode()) {
      this.assertFeature();
      return assertTenantGitDirectory(requireTenantContext().tenant.id, gitdir)
        .then(() => executeGit(['--git-dir', gitdir, ...args]))
        .then((output) => output.toString('utf8'));
    }
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        ['--git-dir', gitdir, ...args],
        { maxBuffer: MAX_BUFFER, timeout: GIT_TIMEOUT, encoding: 'utf8' },
        (err, stdout, stderr) => {
          if (err) return reject(this.gitError(stderr, err));
          resolve(stdout);
        },
      );
    });
  }

  private runGitText(repo: Repo, args: string[]): Promise<string> {
    if (this.isTenantMode()) return this.runGitBuffer(repo, args).then((buffer) => buffer.toString('utf8'));
    return this.execGitText(repo.gitdir, args);
  }

  private runGitBuffer(repo: Repo, args: string[]): Promise<Buffer> {
    if (this.isTenantMode()) {
      this.assertFeature();
      const tenantId = requireTenantContext().tenant.id;
      const external = resolveExternalGitRepository(tenantId, repo.id, repo.gitdir);
      if (external) return external.execute(args);
      return assertTenantGitDirectory(tenantId, repo.gitdir).then(() => executeGit(['--git-dir', repo.gitdir, ...args]));
    }
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        ['--git-dir', repo.gitdir, ...args],
        { maxBuffer: MAX_BUFFER, timeout: GIT_TIMEOUT, encoding: 'buffer' },
        (err, stdout, stderr) => {
          if (err) return reject(this.gitError(stderr?.toString('utf8'), err));
          resolve(stdout);
        },
      );
    });
  }

  private gitError(stderr: string | undefined, err: Error): BadRequestException {
    const msg = (stderr || err.message || 'git error').trim().slice(0, 500);
    return new BadRequestException(`git: ${msg}`);
  }

  private assertRef(ref: string | undefined, fallback?: string): string {
    const value = (ref && ref.trim()) || fallback;
    if (
      !value ||
      value.startsWith('-') ||
      Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
    ) {
      throw new BadRequestException('Некорректная ссылка (ref)');
    }
    return value;
  }

  private assertPath(path: string | undefined): string {
    const value = path ?? '';
    if (value.startsWith('-') || value.includes('\x00')) {
      throw new BadRequestException('Некорректный путь');
    }
    return value.replace(/^\/+/, '');
  }

  // -------------------------------------------------------------------- ветки

  async branches(repoId: number, userId: number): Promise<BranchInfo[]> {
    const repo = await this.getRepoOrThrow(repoId, userId);
    const out = await this.runGitText(repo, [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname:short)%1f%(objectname:short)%1f%(committerdate:iso8601-strict)',
      'refs/heads',
    ]);
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, sha, lastCommitDate] = line.split(FS);
        return { name, sha, lastCommitDate, isDefault: name === repo.defaultBranch };
      });
  }

  // ------------------------------------------------------------------ коммиты

  async commits(
    repoId: number,
    branch: string | undefined,
    page: number,
    perPage: number,
    userId: number,
  ): Promise<CommitInfo[]> {
    const repo = await this.getRepoOrThrow(repoId, userId);
    const ref = this.assertRef(branch, repo.defaultBranch);
    perPage = Number.isFinite(perPage) ? Math.min(100, Math.max(1, Math.floor(perPage))) : 30;
    page = Number.isFinite(page) ? Math.min(100000, Math.max(1, Math.floor(page))) : 1;
    const skip = (page - 1) * perPage;
    const out = await this.runGitText(repo, [
      'log',
      `--skip=${skip}`,
      `--max-count=${perPage}`,
      '-z',
      '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s',
      ref,
      '--',
    ]);
    return out
      .split('\0')
      .filter(Boolean)
      .map((rec) => {
        const [hash, shortHash, authorName, authorEmail, date, subject] = rec.split(FS);
        return { hash, shortHash, authorName, authorEmail, date, subject };
      });
  }

  // --------------------------------------------------------------- дерево файлов

  async tree(repoId: number, ref: string | undefined, path: string, userId: number): Promise<TreeEntry[]> {
    const repo = await this.getRepoOrThrow(repoId, userId);
    const r = this.assertRef(ref, repo.defaultBranch);
    const p = this.assertPath(path);
    const spec = p ? (p.endsWith('/') ? p : `${p}/`) : '';

    const args = ['ls-tree', '-z', '--long', r, '--'];
    if (spec) args.push(spec);
    const out = await this.runGitText(repo, args);

    const entries = out
      .split('\0')
      .filter(Boolean)
      .map((rec): TreeEntry => {
        const tab = rec.indexOf('\t');
        const meta = rec.slice(0, tab).split(/\s+/);
        const fullPath = rec.slice(tab + 1);
        const [mode, type, oid, size] = meta;
        return {
          type: type as TreeEntry['type'],
          mode,
          oid,
          size: size === '-' ? null : Number(size),
          name: fullPath.split('/').pop() ?? fullPath,
          path: fullPath,
        };
      });

    return entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  // ------------------------------------------------------------ содержимое файла

  async file(repoId: number, ref: string | undefined, path: string, userId: number): Promise<FileContent> {
    const repo = await this.getRepoOrThrow(repoId, userId);
    const r = this.assertRef(ref, repo.defaultBranch);
    const p = this.assertPath(path);
    if (!p) throw new BadRequestException('Не указан путь к файлу');
    const spec = `${r}:${p}`;

    const type = (await this.runGitText(repo, ['cat-file', '-t', spec])).trim();
    if (type !== 'blob') throw new BadRequestException('Путь не является файлом');

    const size = Number((await this.runGitText(repo, ['cat-file', '-s', spec])).trim());
    if (size > MAX_FILE_BYTES) {
      return { path: p, ref: r, size, binary: false, truncated: true, content: null };
    }

    const buf = await this.runGitBuffer(repo, ['cat-file', 'blob', spec]);
    const binary = buf.includes(0);
    return {
      path: p,
      ref: r,
      size,
      binary,
      truncated: false,
      content: binary ? null : buf.toString('utf8'),
    };
  }

  /** Сырой блоб с MIME-типом — для показа картинок (в диффах, превью). */
  async rawBlob(repoId: number, ref: string, path: string, userId: number): Promise<{ buffer: Buffer; contentType: string }> {
    const repo = await this.getRepoOrThrow(repoId, userId);
    const r = this.assertRef(ref);
    const p = this.assertPath(path);
    if (!p) throw new BadRequestException('Не указан путь к файлу');
    const spec = `${r}:${p}`;
    const type = (await this.runGitText(repo, ['cat-file', '-t', spec])).trim();
    if (type !== 'blob') throw new BadRequestException('Путь не является файлом');
    const size = Number((await this.runGitText(repo, ['cat-file', '-s', spec])).trim());
    if (size > 25 * 1024 * 1024) throw new BadRequestException('Файл слишком большой');
    const buffer = await this.runGitBuffer(repo, ['cat-file', 'blob', spec]);
    return { buffer, contentType: this.contentTypeFor(p) };
  }

  private contentTypeFor(path: string): string {
    const ext = (path.split('.').pop() ?? '').toLowerCase();
    const map: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      ico: 'image/x-icon',
      bmp: 'image/bmp',
      avif: 'image/avif',
      pdf: 'application/pdf',
    };
    return map[ext] ?? 'application/octet-stream';
  }

  // -------------------------------------------------------------------- диффы

  /** Дифф коммита к его родителю (для первого коммита — к пустому дереву). */
  async diffCommit(repoId: number, commit: string, userId: number): Promise<DiffResult> {
    const repo = await this.getRepoOrThrow(repoId, userId);
    const c = this.assertRef(commit);
    let base = EMPTY_TREE;
    try {
      await this.runGitText(repo, ['rev-parse', '--verify', '--quiet', `${c}^`]);
      base = `${c}^`;
    } catch {
      base = EMPTY_TREE;
    }
    const patch = await this.runGitText(repo, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', base, c, '--']);
    return this.parsePatch(patch);
  }

  /** Дифф ветки head относительно общей базы с base (PR-стиль, A...B). */
  async diffRange(repoId: number, baseRef: string, headRef: string, userId: number): Promise<DiffResult> {
    const repo = await this.getRepoOrThrow(repoId, userId);
    const b = this.assertRef(baseRef);
    const h = this.assertRef(headRef);
    const patch = await this.runGitText(repo, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '-M',
      `${b}...${h}`,
      '--',
    ]);
    return this.parsePatch(patch);
  }

  /** Разбор unified diff в структуру файлов/ханков/строк — рендерим своим UI. */
  private parsePatch(patch: string): DiffResult {
    const files: DiffFile[] = [];
    const lines = patch.split('\n');
    let current: DiffFile | null = null;
    let i = 0;

    const push = () => {
      if (current) files.push(current);
    };

    while (i < lines.length) {
      const line = lines[i];

      if (line.startsWith('diff --git ')) {
        push();
        current = {
          oldPath: null,
          newPath: null,
          status: 'modified',
          binary: false,
          additions: 0,
          deletions: 0,
          hunks: [],
        };
        const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
        if (m) {
          current.oldPath = m[1];
          current.newPath = m[2];
        }
        i++;
        continue;
      }

      if (!current) {
        i++;
        continue;
      }

      if (line.startsWith('new file mode')) {
        current.status = 'added';
        i++;
        continue;
      }
      if (line.startsWith('deleted file mode')) {
        current.status = 'deleted';
        i++;
        continue;
      }
      if (line.startsWith('rename from ')) {
        current.status = 'renamed';
        current.oldPath = line.slice('rename from '.length);
        i++;
        continue;
      }
      if (line.startsWith('rename to ')) {
        current.newPath = line.slice('rename to '.length);
        i++;
        continue;
      }
      if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
        current.binary = true;
        i++;
        continue;
      }
      if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('index ')) {
        i++;
        continue;
      }

      if (line.startsWith('@@')) {
        const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        let oldNo = m ? Number(m[1]) : 0;
        let newNo = m ? Number(m[2]) : 0;
        const hunk: DiffHunk = { header: line, lines: [] };
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (l.startsWith('diff --git ') || l.startsWith('@@')) break;
          if (l.startsWith('\\')) {
            i++;
            continue; // "\ No newline at end of file"
          }
          const t = l[0];
          if (t === '+') {
            hunk.lines.push({ type: 'add', content: l.slice(1), oldNo: null, newNo: newNo++ });
            current.additions++;
          } else if (t === '-') {
            hunk.lines.push({ type: 'del', content: l.slice(1), oldNo: oldNo++, newNo: null });
            current.deletions++;
          } else if (t === ' ') {
            hunk.lines.push({ type: 'ctx', content: l.slice(1), oldNo: oldNo++, newNo: newNo++ });
          }
          i++;
        }
        current.hunks.push(hunk);
        continue;
      }

      i++;
    }

    push();
    return { files, fileCount: files.length };
  }
}
