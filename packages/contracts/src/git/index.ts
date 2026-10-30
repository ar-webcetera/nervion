/** SaaS accepts remoteUrl; legacy self-hosted installations accept gitdir. */
export interface GitConnectRequest {
  name: string;
  projectId?: number;
  defaultBranch?: string;
  gitdir?: string;
  remoteUrl?: string;
  username?: string;
  token?: string;
}
export * from "./git.enums";
export * from "./git.types";
