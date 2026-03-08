import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export const CONFIG_FILE = 'synap.config.json';
export const LOCK_FILE = 'synap.lock.json';

/**
 * Load the project config file (synap.config.json).
 * Throws a friendly error if it doesn't exist.
 */
export function loadConfig(cwd = process.cwd()) {
  const configPath = join(cwd, CONFIG_FILE);

  if (!existsSync(configPath)) {
    throw new Error(
      `No ${CONFIG_FILE} found. Run \`synap init\` to create one.`
    );
  }

  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    throw new Error(`Failed to parse ${CONFIG_FILE}. Check it's valid JSON.`);
  }
}

/**
 * Write the project config file.
 */
export function saveConfig(config, cwd = process.cwd()) {
  const configPath = join(cwd, CONFIG_FILE);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

/**
 * Load the lockfile (synap.lock.json).
 * Returns an empty object if it doesn't exist yet.
 */
export function loadLock(cwd = process.cwd()) {
  const lockPath = join(cwd, LOCK_FILE);
  if (!existsSync(lockPath)) return {};

  try {
    return JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Write the lockfile.
 */
export function saveLock(lock, cwd = process.cwd()) {
  const lockPath = join(cwd, LOCK_FILE);
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
}

/**
 * Parse a GitHub repo URL or "owner/repo" shorthand into { owner, repo }.
 */
export function parseRepoString(repo) {
  // Handle full GitHub URLs
  const urlMatch = repo.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  // Handle "owner/repo" shorthand
  const parts = repo.split('/');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { owner: parts[0], repo: parts[1] };
  }

  throw new Error(
    `Invalid repo format "${repo}". Use "owner/repo" or a full GitHub URL.`
  );
}
