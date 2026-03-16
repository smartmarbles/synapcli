import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CACHE_DIR  = join(homedir(), '.synap');
const CACHE_FILE = join(CACHE_DIR, 'completions.json');

/** Cache TTL in milliseconds (10 minutes) */
const TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  files: string[];
  cachedAt: string;
}

type CompletionCache = Record<string, CacheEntry>;

function readCache(): CompletionCache {
  try {
    if (!existsSync(CACHE_FILE)) return {};
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as CompletionCache;
  } catch {
    return {};
  }
}

function writeCache(cache: CompletionCache): void {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    // Cache writes are best-effort — never fail the main command
  }
}

/**
 * Write a list of remote file paths to the completion cache.
 * Keyed by the project's cwd so different projects don't collide.
 */
export function writeCompletionCache(files: string[], cwd: string = process.cwd()): void {
  const cache = readCache();
  cache[cwd] = { files, cachedAt: new Date().toISOString() };
  writeCache(cache);
}

/**
 * Look up completions for a partial string from the cache.
 * Returns an empty array if the cache is missing or stale.
 */
export function getCompletions(partial: string, cwd: string = process.cwd()): string[] {
  const cache = readCache();
  const entry = cache[cwd];

  if (!entry) return [];

  const age = Date.now() - new Date(entry.cachedAt).getTime();
  if (age > TTL_MS) return [];

  const lower = partial.toLowerCase();

  // Match on the filename portion only (after last slash) as well as full path
  return entry.files.filter((f) => {
    const filename = f.split('/').pop() ?? f;
    return f.toLowerCase().includes(lower) || filename.toLowerCase().startsWith(lower);
  });
}
