// ─── Config ──────────────────────────────────────────────────────────────────

export interface SynapConfig {
  repo: string;
  branch: string;
  remotePath: string;
  localOutput: string;
  auth?: string;
}

// ─── Lockfile ─────────────────────────────────────────────────────────────────

export interface LockEntry {
  sha: string;
  ref: string;
  pulledAt: string;
}

export type LockFile = Record<string, LockEntry>;

// ─── GitHub ───────────────────────────────────────────────────────────────────

export interface RemoteFile {
  path: string;
  sha: string;
  size: number;
}

export interface FetchedFile {
  content: string;
  sha: string;
  size: number;
  downloadUrl: string;
}

export interface RepoParams {
  owner: string;
  repo: string;
  path?: string;
  ref?: string;
}

export interface ParsedRepo {
  owner: string;
  repo: string;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export interface PullOptions {
  force?: boolean;
  dryRun?: boolean;
  branch?: string;
}

export interface UpdateOptions {
  force?: boolean;
}

export interface ListOptions {
  json?: boolean;
}

export interface DeleteOptions {
  force?: boolean;
  dryRun?: boolean;
}

// ─── File utils ───────────────────────────────────────────────────────────────

export interface ResolveLocalPathParams {
  remotePath: string;
  remoteBase?: string;
  localOutput?: string;
  cwd?: string;
}
