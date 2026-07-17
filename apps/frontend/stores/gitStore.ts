import { defineStore } from 'pinia';
import type {
  GitBranch,
  GitCommit,
  GitDetail,
  GitDiffResult,
  GitFileContent,
  GitRepo,
  GitTreeEntry,
} from '~/types/git';

export const useGitStore = defineStore('git', () => {
  const config = useRuntimeConfig();

  const request = <T>(url: string, query?: Record<string, unknown>): Promise<T> => {
    const headers = useRequestHeaders(['cookie']);
    return $fetch<T>(url, {
      baseURL: config.public.API_URL,
      credentials: 'include',
      headers,
      query,
    });
  };

  const send = <T = unknown>(url: string, method: 'POST' | 'DELETE', body?: unknown): Promise<T> => {
    const headers = useRequestHeaders(['cookie']);
    return $fetch<T>(url, {
      baseURL: config.public.API_URL,
      credentials: 'include',
      headers,
      method,
      body: body as Record<string, unknown> | undefined,
    });
  };

  const fetchRepos = (projectId?: number) =>
    request<GitRepo[]>('/api/git/repos', projectId ? { projectId } : undefined);

  const fetchBranches = (repoId: number) => request<GitBranch[]>(`/api/git/${repoId}/branches`);

  const fetchCommits = (repoId: number, branch: string, page = 1, perPage = 50) =>
    request<GitCommit[]>(`/api/git/${repoId}/commits`, { branch, page, perPage });

  const fetchTree = (repoId: number, ref: string, path = '') =>
    request<GitTreeEntry[]>(`/api/git/${repoId}/tree`, { ref, path });

  const fetchFile = (repoId: number, ref: string, path: string) =>
    request<GitFileContent>(`/api/git/${repoId}/file`, { ref, path });

  const fetchCommitDiff = (repoId: number, commit: string) =>
    request<GitDiffResult>(`/api/git/${repoId}/diff`, { commit });

  const fetchRangeDiff = (repoId: number, base: string, head: string) =>
    request<GitDiffResult>(`/api/git/${repoId}/diff`, { base, head });

  const createRepo = (payload: { name: string; gitdir: string; defaultBranch?: string; projectId?: number }) =>
    send<GitRepo>('/api/git/repos', 'POST', payload);

  const deleteRepo = (id: number) => send(`/api/git/repos/${id}`, 'DELETE');

  // --- состояние текущего вида в сторе: Pinia state надёжно гидрируется через
  const repos = ref<GitRepo[]>([]);
  const branches = ref<GitBranch[]>([]);
  const commits = ref<GitCommit[]>([]);
  const tree = ref<GitTreeEntry[]>([]);
  const currentRepoId = ref<number | null>(null);
  const currentBranch = ref<string>('');
  const detail = ref<GitDetail | null>(null);
  const detailLoading = ref(false);

  const loadDetail = async (commit?: string, file?: string) => {
    if (currentRepoId.value == null) {
      detail.value = null;
      return;
    }
    if (commit) {
      if (detail.value?.kind === 'diff' && detail.value.commit.hash === commit) return;
      detailLoading.value = true;
      try {
        const data = await fetchCommitDiff(currentRepoId.value, commit);
        const c = commits.value.find((x) => x.hash === commit) ?? {
          hash: commit,
          shortHash: commit.slice(0, 8),
          authorName: '',
          authorEmail: '',
          date: '',
          subject: commit.slice(0, 8),
        };
        detail.value = { kind: 'diff', commit: c, data };
      } finally {
        detailLoading.value = false;
      }
    } else if (file) {
      if (detail.value?.kind === 'file' && detail.value.entry.path === file) return;
      detailLoading.value = true;
      try {
        const data = await fetchFile(currentRepoId.value, currentBranch.value, file);
        detail.value = {
          kind: 'file',
          entry: { type: 'blob', mode: '', oid: '', size: data.size, name: file.split('/').pop() ?? file, path: file },
          data,
        };
      } finally {
        detailLoading.value = false;
      }
    } else {
      detail.value = null;
    }
  };

  const loadRefData = async () => {
    if (currentRepoId.value == null || !currentBranch.value) {
      commits.value = [];
      tree.value = [];
      return;
    }
    const [cm, tr] = await Promise.all([
      fetchCommits(currentRepoId.value, currentBranch.value),
      fetchTree(currentRepoId.value, currentBranch.value, ''),
    ]);
    commits.value = cm;
    tree.value = tr;
  };

  const selectRepo = async (id: number) => {
    currentRepoId.value = id;
    const brs = await fetchBranches(id);
    branches.value = brs;
    const def = brs.find((b) => b.isDefault) ?? brs[0];
    currentBranch.value = def ? def.name : '';
    await loadRefData();
  };

  const selectBranch = async (name: string) => {
    currentBranch.value = name;
    await loadRefData();
  };

  const loadInitial = async (repoId?: number, branch?: string, commit?: string, file?: string) => {
    const query: Record<string, unknown> = {};
    if (repoId != null) query.repo = repoId;
    if (branch) query.branch = branch;
    if (commit) query.commit = commit;
    if (file) query.file = file;
    const data = await request<{
      repos: GitRepo[];
      repoId: number | null;
      branch: string;
      branches: GitBranch[];
      commits: GitCommit[];
      tree: GitTreeEntry[];
      detail: GitDetail | null;
    }>('/api/git/initial', query);
    repos.value = data.repos;
    branches.value = data.branches;
    commits.value = data.commits;
    tree.value = data.tree;
    currentRepoId.value = data.repoId;
    currentBranch.value = data.branch;
    detail.value = data.detail;
  };

  const refreshAndSelect = async (id: number) => {
    repos.value = await fetchRepos();
    await selectRepo(id);
  };

  return {
    repos,
    branches,
    commits,
    tree,
    currentRepoId,
    currentBranch,
    detail,
    detailLoading,
    loadInitial,
    loadDetail,
    selectRepo,
    selectBranch,
    refreshAndSelect,
    fetchRepos,
    fetchBranches,
    fetchCommits,
    fetchTree,
    fetchFile,
    fetchCommitDiff,
    fetchRangeDiff,
    createRepo,
    deleteRepo,
  };
});
