export interface GitRepo {
  id: number;
  projectId: number | null;
  name: string;
  defaultBranch: string;
  cloneUrl: string | null;
}

export interface GitBranch {
  name: string;
  sha: string;
  lastCommitDate: string;
  isDefault: boolean;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  date: string;
  subject: string;
}

export interface GitTreeEntry {
  type: 'tree' | 'blob' | 'commit';
  mode: string;
  oid: string;
  size: number | null;
  name: string;
  path: string;
}

export interface GitFileContent {
  path: string;
  ref: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  content: string | null;
}

export type GitDiffLineType = 'add' | 'del' | 'ctx';

export interface GitDiffLine {
  type: GitDiffLineType;
  content: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface GitDiffHunk {
  header: string;
  lines: GitDiffLine[];
}

export interface GitDiffFile {
  oldPath: string | null;
  newPath: string | null;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: GitDiffHunk[];
}

export interface GitDiffResult {
  files: GitDiffFile[];
  fileCount: number;
}

export type GitDetail =
  | { kind: 'diff'; commit: GitCommit; data: GitDiffResult }
  | { kind: 'file'; entry: GitTreeEntry; data: GitFileContent };
