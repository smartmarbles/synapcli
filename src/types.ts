// ─── Source Config ────────────────────────────────────────────────────────────

export interface SourceConfig {
  /** Human-readable label shown in multi-source output */
  name?: string;
  repo: string;
  branch: string;
  remotePath: string;
  localOutput: string;
  /** Glob patterns — only matching files are pulled */
  include?: string[];
  /** Glob patterns — matching files are skipped */
  exclude?: string[];
}

// ─── Top-level Config ─────────────────────────────────────────────────────────

export interface SynapConfig {
  /** Multi-source format */
  sources?: SourceConfig[];
  /** Legacy single-source fields (still supported) */
  repo?: string;
  branch?: string;
  remotePath?: string;
  localOutput?: string;
  auth?: string;
  /** Shell command to run after any pull/update operation */
  postpull?: string;
}

// ─── Lockfile ─────────────────────────────────────────────────────────────────

export interface LockEntry {
  sha: string;
  ref: string;
  pulledAt: string;
}

/** Keys are namespaced as "owner/repo::path/to/file" */
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
  retryFailed?: boolean;
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

// ─── Status ───────────────────────────────────────────────────────────────────

export type FileStatus = 'up-to-date' | 'changed' | 'not-pulled' | 'missing-locally';

export interface StatusEntry {
  remotePath: string;
  localPath: string;
  status: FileStatus;
  source: SourceConfig;
}

// ─── Exit Codes ───────────────────────────────────────────────────────────────

export const ExitCode = {
  Success:       0,
  GeneralError:  1,
  ConfigError:   2,
  AuthError:     3,
  NetworkError:  4,
  ConflictError: 5,
} as const;

export type ExitCodeValue = typeof ExitCode[keyof typeof ExitCode];
