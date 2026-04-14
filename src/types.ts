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
  /** Origin of the source — URL or file path of the collection it was imported from */
  _importedFrom?: string;
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
  ref?: string;
  retryFailed?: boolean;
  interactive?: boolean;
}

export interface UpdateOptions {
  force?: boolean;
  interactive?: boolean;
}

export interface ListOptions {
  json?: boolean;
  source?: string;
}

export interface DeleteOptions {
  force?: boolean;
  dryRun?: boolean;
}

export interface RegisterOptions {
  from?: string;
  ref?: string;
  yes?: boolean;
}

// ─── File utils ───────────────────────────────────────────────────────────────

export interface ResolveLocalPathParams {
  remotePath: string;
  remoteBase?: string;
  localOutput?: string;
  cwd?: string;
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export interface PreviewFile {
  file: RemoteFile;
  localPath: string;
  isNew: boolean;
  source: SourceConfig;
  /** True when the local file has been edited since last pull */
  locallyModified?: boolean;
}

// ─── Status ───────────────────────────────────────────────────────────────────

export type FileStatus = 'up-to-date' | 'changed' | 'not-pulled' | 'missing-locally' | 'removed-upstream';

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
