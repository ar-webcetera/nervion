import type { GitRepositoryAvailability, GitRepositoryMode } from "./git.enums";

export interface GitRepositoryCapabilities {
  canRead: boolean;
  canFetch: boolean;
  canDelete: boolean;
}

/** Public repository metadata. Filesystem paths and credentials stay on the server. */
export interface GitRepoListItem {
  id: number;
  projectId: number | null;
  name: string;
  defaultBranch: string;
  cloneUrl: string | null;
  mode: GitRepositoryMode;
  availability: GitRepositoryAvailability;
  capabilities: GitRepositoryCapabilities;
}
