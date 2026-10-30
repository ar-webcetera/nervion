import { defineStore } from 'pinia';
import type { GitConnectRequest } from '@tracker/contracts';
import type { GitBranch, GitCommit, GitDetail, GitDiffResult, GitFileContent, GitRepo, GitTreeEntry } from '~/types/git';
import { canReadGitRepository } from '~/utils/gitRepository';
import { useTenantStore } from '~/stores/tenantStore';

export const useGitStore = defineStore('git', () => {
  const tenantFetch = useTenantFetch();
  const tenantApiBaseUrl = useApiBaseUrl();
  const tenantStore = useTenantStore();

  const assertReadable = (repoId: number) => {
    if (!canReadGitRepository(repos.value.find((repository) => repository.id === repoId))) {
      throw new Error('Репозиторий недоступен');
    }
  };

  const request = <T>(url: string, query?: Record<string, string | number | boolean>): Promise<T> => {
    const headers = useApiRequestHeaders();
    return tenantFetch<T>(url, {
      baseURL: tenantApiBaseUrl,
      credentials: 'include',
      headers,
      query,
    });
  };

  const send = <T = void>(
    url: string,
    method: 'POST' | 'DELETE',
    body?: Record<string, string | number | undefined>,
  ): Promise<T> => {
    const headers = useApiRequestHeaders();
    return tenantFetch<T>(url, {
      baseURL: tenantApiBaseUrl,
      credentials: 'include',
      headers,
      method,
      body,
    });
  };

  const fetchRepos = (projectId?: number) => request<GitRepo[]>('/api/git/repos', projectId ? { projectId } : undefined);

  const readRepository = <T>(repoId: number, path: string, query?: Record<string, string | number>): Promise<T> => {
    assertReadable(repoId);
    return request<T>(`/api/git/${repoId}/${path}`, query);
  };

  const fetchBranches = (repoId: number) => readRepository<GitBranch[]>(repoId, 'branches');

  const fetchCommits = (repoId: number, branch: string, page = 1, perPage = 50) =>
    readRepository<GitCommit[]>(repoId, 'commits', { branch, page, perPage });

  const fetchTree = (repoId: number, ref: string, path = '') => readRepository<GitTreeEntry[]>(repoId, 'tree', { ref, path });

  const fetchFile = (repoId: number, ref: string, path: string) => readRepository<GitFileContent>(repoId, 'file', { ref, path });

  const fetchCommitDiff = (repoId: number, commit: string) => readRepository<GitDiffResult>(repoId, 'diff', { commit });

  const fetchRangeDiff = (repoId: number, base: string, head: string) =>
    readRepository<GitDiffResult>(repoId, 'diff', { base, head });

  const createRepo = (payload: GitConnectRequest) => send<GitRepo>('/api/git/repos', 'POST', { ...payload });

  const deleteRepo = async (id: number) => {
    const repository = repos.value.find((repo) => repo.id === id);
    if (tenantStore.readOnly || !repository?.capabilities.canDelete) {
      throw new Error('Удаление репозитория недоступно');
    }
    return send(`/api/git/repos/${id}`, 'DELETE');
  };
  const syncRepo = async (id: number) => {
    const repository = repos.value.find((repo) => repo.id === id);
    if (tenantStore.readOnly || !repository?.capabilities.canFetch) {
      throw new Error('Получение изменений недоступно');
    }
    return send<GitRepo>(`/api/git/repos/${id}/fetch`, 'POST');
  };

  // --- состояние текущего вида в сторе: Pinia state надёжно гидрируется через
  const repos = ref<GitRepo[]>([]);
  const branches = ref<GitBranch[]>([]);
  const commits = ref<GitCommit[]>([]);
  const tree = ref<GitTreeEntry[]>([]);
  const currentRepoId = ref<number | null>(null);
  const currentBranch = ref<string>('');
  const detail = ref<GitDetail | null>(null);
  const detailLoading = ref(false);
  const selectionLoading = ref(false);
  let viewRevision = 0;
  let detailRevision = 0;

  const selectedRepo = computed(() => repos.value.find((repo) => repo.id === currentRepoId.value) ?? null);

  const clearDetail = () => {
    detailRevision++;
    detail.value = null;
    detailLoading.value = false;
  };

  const clearRefData = () => {
    commits.value = [];
    tree.value = [];
    clearDetail();
  };

  const loadDetail = async (commit?: string, file?: string) => {
    if (currentRepoId.value == null || !canReadGitRepository(selectedRepo.value)) {
      clearDetail();
      return;
    }
    const repoId = currentRepoId.value;
    const selectedBranch = currentBranch.value;
    const revision = viewRevision;
    const requestRevision = ++detailRevision;
    const isCurrent = () => revision === viewRevision && requestRevision === detailRevision;
    if (commit) {
      if (detail.value?.kind === 'diff' && detail.value.commit.hash === commit) return;
      detail.value = null;
      detailLoading.value = true;
      try {
        const data = await fetchCommitDiff(repoId, commit);
        if (!isCurrent()) return;
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
        if (isCurrent()) detailLoading.value = false;
      }
    } else if (file) {
      if (detail.value?.kind === 'file' && detail.value.entry.path === file) return;
      detail.value = null;
      detailLoading.value = true;
      try {
        const data = await fetchFile(repoId, selectedBranch, file);
        if (!isCurrent()) return;
        detail.value = {
          kind: 'file',
          entry: { type: 'blob', mode: '', oid: '', size: data.size, name: file.split('/').pop() ?? file, path: file },
          data,
        };
      } finally {
        if (isCurrent()) detailLoading.value = false;
      }
    } else {
      clearDetail();
    }
  };

  const loadRefData = async () => {
    clearRefData();
    if (currentRepoId.value == null || !currentBranch.value || !canReadGitRepository(selectedRepo.value)) return;
    const revision = viewRevision;
    const [cm, tr] = await Promise.all([
      fetchCommits(currentRepoId.value, currentBranch.value),
      fetchTree(currentRepoId.value, currentBranch.value, ''),
    ]);
    if (revision !== viewRevision) return;
    commits.value = cm;
    tree.value = tr;
  };

  const selectRepo = async (id: number) => {
    const revision = ++viewRevision;
    currentRepoId.value = repos.value.some((repo) => repo.id === id) ? id : null;
    currentBranch.value = '';
    branches.value = [];
    clearRefData();
    selectionLoading.value = false;
    if (!canReadGitRepository(selectedRepo.value)) return;
    selectionLoading.value = true;
    try {
      const brs = await fetchBranches(id);
      if (revision !== viewRevision) return;
      branches.value = brs;
      const def = brs.find((b) => b.isDefault) ?? brs[0];
      currentBranch.value = def ? def.name : '';
      await loadRefData();
    } finally {
      if (revision === viewRevision) selectionLoading.value = false;
    }
  };

  const selectBranch = async (name: string) => {
    const revision = ++viewRevision;
    currentBranch.value = name;
    selectionLoading.value = true;
    try {
      await loadRefData();
    } finally {
      if (revision === viewRevision) selectionLoading.value = false;
    }
  };

  const loadInitial = async (repoId?: number, branch?: string, commit?: string, file?: string) => {
    const revision = ++viewRevision;
    clearRefData();
    branches.value = [];
    selectionLoading.value = true;
    const query: Record<string, string | number> = {};
    if (repoId != null) query.repo = repoId;
    if (branch) query.branch = branch;
    if (commit) query.commit = commit;
    if (file) query.file = file;
    try {
      const data = await request<{
        repos: GitRepo[];
        repoId: number | null;
        branch: string;
        branches: GitBranch[];
        commits: GitCommit[];
        tree: GitTreeEntry[];
        detail: GitDetail | null;
      }>('/api/git/initial', query);
      if (revision !== viewRevision) return;
      repos.value = data.repos;
      currentRepoId.value = data.repoId;
      currentBranch.value = '';
      if (!canReadGitRepository(selectedRepo.value)) return;
      branches.value = data.branches;
      commits.value = data.commits;
      tree.value = data.tree;
      currentBranch.value = data.branch;
      detail.value = data.detail;
    } finally {
      if (revision === viewRevision) selectionLoading.value = false;
    }
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
    selectionLoading,
    selectedRepo,
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
    syncRepo,
  };
});
