import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SynapConfig, LockFile, ParsedRepo, SourceConfig } from '../types.js';

export const CONFIG_FILE = 'synap.config.json';
export const LOCK_FILE   = 'synap.lock.json';

// Lock key separator — chosen to be safe in file paths
const LOCK_SEP = '::';

export function loadConfig(cwd: string = process.cwd()): SynapConfig {
  const configPath = join(cwd, CONFIG_FILE);

  if (!existsSync(configPath)) {
    throw new Error(`No ${CONFIG_FILE} found. Run \`synap init\` to create one.`);
  }

  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as SynapConfig;
  } catch {
    throw new Error(`Failed to parse ${CONFIG_FILE}. Check it's valid JSON.`);
  }
}

export function saveConfig(config: SynapConfig, cwd: string = process.cwd()): void {
  const configPath = join(cwd, CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function loadLock(cwd: string = process.cwd()): LockFile {
  const lockPath = join(cwd, LOCK_FILE);
  if (!existsSync(lockPath)) return {};

  try {
    return JSON.parse(readFileSync(lockPath, 'utf8')) as LockFile;
  } catch {
    return {};
  }
}

export function saveLock(lock: LockFile, cwd: string = process.cwd()): void {
  const lockPath = join(cwd, LOCK_FILE);
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
}

/**
 * Build a namespaced lock key for a given repo and file path.
 * Format: "owner/repo::path/to/file"
 */
export function lockKey(repo: string, filePath: string): string {
  return `${repo}${LOCK_SEP}${filePath}`;
}

/**
 * Normalise a config into a consistent array of SourceConfig objects.
 * Supports both the legacy single-source format and the new multi-source format.
 */
export function resolvedSources(config: SynapConfig): SourceConfig[] {
  if (config.sources && config.sources.length > 0) {
    return config.sources;
  }

  // Legacy single-source fallback
  if (config.repo) {
    return [
      {
        name: config.repo,
        repo: config.repo,
        branch: config.branch ?? 'main',
        remotePath: config.remotePath ?? '',
        localOutput: config.localOutput ?? '.',
        include: undefined,
        exclude: undefined,
      },
    ];
  }

  throw new Error(
    `${CONFIG_FILE} must contain either a "repo" field or a "sources" array.`
  );
}

/**
 * Migrate a single-source config to the multi-source sources array format.
 * If already in multi-source format, returns as-is.
 */
export function migrateToMultiSource(config: SynapConfig): SynapConfig {
  if (config.sources && config.sources.length > 0) return config;

  if (config.repo) {
    const source: SourceConfig = {
      name: config.repo,
      repo: config.repo,
      branch: config.branch ?? 'main',
      remotePath: config.remotePath ?? '',
      localOutput: config.localOutput ?? '.',
    };

    const migrated: SynapConfig = {
      sources: [source],
      ...(config.postpull && { postpull: config.postpull }),
    };

    return migrated;
  }

  return config;
}

/**
 * Parse a GitHub repo URL or "owner/repo" shorthand into { owner, repo }.
 */
export function parseRepoString(repo: string): ParsedRepo {
  const urlMatch = repo.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  const parts = repo.split('/');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { owner: parts[0], repo: parts[1] };
  }

  throw new Error(
    `Invalid repo format "${repo}". Use "owner/repo" or a full GitHub URL.`
  );
}
