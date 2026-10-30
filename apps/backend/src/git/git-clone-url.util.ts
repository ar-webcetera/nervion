import * as path from 'path';
import { GitRepositoryAvailability, GitRepositoryMode, type GitRepoListItem } from '@tracker/contracts';

export type { GitRepoListItem } from '@tracker/contracts';

export const buildGitCloneUrl = (gitdir: string, baseUrl = process.env.GIT_CLONE_BASE_URL): string | null => {
  const base = baseUrl?.trim();
  if (!base) return null;

  const repoDir = path.basename(gitdir.trim());
  if (!repoDir) return null;

  const slug = repoDir.endsWith('.git') ? repoDir : `${repoDir}.git`;
  return `${base.replace(/\/+$/, '')}/${slug}`;
};

export const toGitRepoListItem = (repo: {
  id: number;
  projectId: number | null;
  name: string;
  defaultBranch: string;
  gitdir: string;
}): GitRepoListItem => ({
  id: repo.id,
  projectId: repo.projectId,
  name: repo.name,
  defaultBranch: repo.defaultBranch,
  cloneUrl: buildGitCloneUrl(repo.gitdir),
  mode: GitRepositoryMode.SELF_HOSTED,
  availability: GitRepositoryAvailability.AVAILABLE,
  capabilities: { canRead: true, canFetch: false, canDelete: true },
});
