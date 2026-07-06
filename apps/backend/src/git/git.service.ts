import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { execFile } from 'child_process';
import { Repo } from './entities/repo.entity';
import { CreateRepoDto } from './dto/create-repo.dto';
import { GitRepoListItem, toGitRepoListItem } from './git-clone-url.util';

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
export class GitService {
  constructor(
    @InjectRepository(Repo)
    private readonly reposRepo: Repository<Repo>,
  ) {}

  // ---------------------------------------------------------------- репозитории

  listRepos(projectId?: number): Promise<GitRepoListItem[]> {
    return this.reposRepo
      .find({
        where: projectId ? { projectId } : {},
        order: { name: 'ASC' },
      })
      .then((repos) => repos.map(toGitRepoListItem));
  }

  /** Подключить существующий git-каталог (bare-репа или .../.git) как репозиторий трекера. */
  async createRepo(dto: CreateRepoDto): Promise<GitRepoListItem> {
    const gitdir = dto.gitdir.trim();
    if (!gitdir.startsWith('/')) {
      throw new BadRequestException('Путь должен быть абсолютным');
    }
    // проверяем, что по пути действительно git-репозиторий
    try {
      await this.execGitText(gitdir, ['rev-parse', '--git-dir']);
    } catch {
      throw new BadRequestException('По указанному пути нет git-репозитория');
    }

    let defaultBranch = dto.defaultBranch?.trim() ?? '';
    if (!defaultBranch) {
      // определяем ветку по умолчанию автоматически: HEAD, иначе первая ветка
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
      return toGitRepoListItem(saved);
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

  async deleteRepo(id: number): Promise<void> {
    const repo = await this.getRepoOrThrow(id);
    await this.reposRepo.remove(repo);
  }

  /**
   * Первичные данные раздела одним запросом: список репозиториев + ветки/коммиты/дерево
   * первого репо. Весь каскад выполняется на бэке (git локальный, быстрый), поэтому
   * SSR делает один надёжный fetch и состояние не приходит частичным.
   */
  async getInitial(
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
    const reposList = await this.listRepos(projectId);
    if (!reposList.length) {
      return { repos: [], repoId: null, branch: '', branches: [], commits: [], tree: [], detail: null };
    }
    const selected = (repoId != null ? reposList.find((r) => r.id === repoId) : undefined) ?? reposList[0];
    const branchList = await this.branches(selected.id);
    const wanted = branchName && branchList.some((b) => b.name === branchName) ? branchName : undefined;
    const branch = wanted ?? (branchList.find((b) => b.isDefault) ?? branchList[0])?.name ?? '';
    let commitList: CommitInfo[] = [];
    let treeList: TreeEntry[] = [];
    if (branch) {
      [commitList, treeList] = await Promise.all([this.commits(selected.id, branch), this.tree(selected.id, branch, '')]);
    }

    // Деталь (дифф коммита / файл) грузим тут же — чтобы её рендерил SSR, без мелькания на клиенте.
    let detail:
      | { kind: 'diff'; commit: CommitInfo; data: DiffResult }
      | { kind: 'file'; entry: TreeEntry; data: FileContent }
      | null = null;
    try {
      if (commit) {
        const data = await this.diffCommit(selected.id, commit);
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
        const data = await this.file(selected.id, branch, file);
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

  private async getRepoOrThrow(repoId: number): Promise<Repo> {
    const repo = await this.reposRepo.findOne({ where: { id: repoId } });
    if (!repo) throw new NotFoundException('Репозиторий не найден');
    return repo;
  }

  // ------------------------------------------------------------ низкоуровневый git

  /**
   * Безопасный вызов git: аргументы передаём массивом (без shell), поэтому
   * инъекции невозможны. ref/path дополнительно валидируем, пути ставим после '--'.
   */
  private execGitText(gitdir: string, args: string[]): Promise<string> {
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
    return this.execGitText(repo.gitdir, args);
  }

  private runGitBuffer(repo: Repo, args: string[]): Promise<Buffer> {
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
    if (!value || value.startsWith('-') || value.includes('\x00') || value.includes('\n')) {
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

  async branches(repoId: number): Promise<BranchInfo[]> {
    const repo = await this.getRepoOrThrow(repoId);
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

  async commits(repoId: number, branch?: string, page = 1, perPage = 30): Promise<CommitInfo[]> {
    const repo = await this.getRepoOrThrow(repoId);
    const ref = this.assertRef(branch, repo.defaultBranch);
    const skip = (Math.max(1, page) - 1) * perPage;
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

  async tree(repoId: number, ref?: string, path = ''): Promise<TreeEntry[]> {
    const repo = await this.getRepoOrThrow(repoId);
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

    // папки сверху, затем файлы; внутри — по алфавиту
    return entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  // ------------------------------------------------------------ содержимое файла

  async file(repoId: number, ref: string | undefined, path: string): Promise<FileContent> {
    const repo = await this.getRepoOrThrow(repoId);
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
  async rawBlob(repoId: number, ref: string, path: string): Promise<{ buffer: Buffer; contentType: string }> {
    const repo = await this.getRepoOrThrow(repoId);
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
  async diffCommit(repoId: number, commit: string): Promise<DiffResult> {
    const repo = await this.getRepoOrThrow(repoId);
    const c = this.assertRef(commit);
    let base = EMPTY_TREE;
    try {
      await this.runGitText(repo, ['rev-parse', '--verify', '--quiet', `${c}^`]);
      base = `${c}^`;
    } catch {
      base = EMPTY_TREE;
    }
    const patch = await this.runGitText(repo, ['diff', '--no-color', '-M', base, c, '--']);
    return this.parsePatch(patch);
  }

  /** Дифф ветки head относительно общей базы с base (PR-стиль, A...B). */
  async diffRange(repoId: number, baseRef: string, headRef: string): Promise<DiffResult> {
    const repo = await this.getRepoOrThrow(repoId);
    const b = this.assertRef(baseRef);
    const h = this.assertRef(headRef);
    const patch = await this.runGitText(repo, ['diff', '--no-color', '-M', `${b}...${h}`, '--']);
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
          } else {
            // пустая строка/прочее в теле ханка — пропускаем
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
