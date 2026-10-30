import { GitRepositoryAvailability, type GitRepoListItem } from '@tracker/contracts';

export const canReadGitRepository = (repository: GitRepoListItem | null | undefined): boolean =>
  repository?.availability === GitRepositoryAvailability.AVAILABLE && repository.capabilities.canRead;
