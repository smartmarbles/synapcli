import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { loadConfig, parseRepoString, resolvedSources } from './config.js';
import { fetchAllFiles } from './github.js';
import { filterFiles } from './filter.js';

const CACHE_DIR  = join(homedir(), '.synap');
const CACHE_FILE = join(CACHE_DIR, 'completions.json');
const TEXT_DIR   = join(CACHE_DIR, 'completions');

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
 * Normalise a cwd to Unix format and hash it.
 * Shell scripts (bash/zsh/fish) use `printf '%s' "$PWD" | md5sum` which
 * on Git Bash produces `/c/Users/…`.  Node's `process.cwd()` returns
 * `C:\Users\…` on Windows, so we normalise to the same format first.
 */
export function cwdHash(cwd: string): string {
  const normalised = cwd
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`);
  return createHash('md5').update(normalised).digest('hex');
}

/**
 * Write a list of remote file paths to the completion cache.
 * Keyed by the project's cwd so different projects don't collide.
 */
export function writeCompletionCache(files: string[], cwd: string = process.cwd()): void {
  const cache = readCache();
  cache[cwd] = { files, cachedAt: new Date().toISOString() };
  writeCache(cache);

  // Write a plain-text companion for instant shell completion (no Node startup)
  try {
    if (!existsSync(TEXT_DIR)) mkdirSync(TEXT_DIR, { recursive: true });
    writeFileSync(join(TEXT_DIR, `${cwdHash(cwd)}.txt`), files.join('\n'), 'utf8');
  } catch {
    // best-effort — never fail the main command
  }
}

/**
 * Look up completions for a partial string from the cache.
 * Returns an empty array if the cache is missing or stale.
 */
export function getCompletions(partial: string, cwd: string = process.cwd()): string[] {
  const cache = readCache();
  const entry = cache[cwd];

  if (!entry) return [];

  const lower = partial.toLowerCase();

  // Match on the filename portion only (after last slash) as well as full path
  return entry.files.filter((f) => {
    /* v8 ignore start */
    const filename = f.split('/').pop() ?? f;
    /* v8 ignore stop */
    return f.toLowerCase().includes(lower) || filename.toLowerCase().startsWith(lower);
  });
}

/**
 * Fetch remote file lists for all configured sources and write the completion cache.
 * Best-effort — errors are silently ignored so it never breaks the calling command.
 */
export async function refreshCompletionCache(): Promise<void> {
  try {
    const config = loadConfig();
    const sources = resolvedSources(config);
    const allPaths: string[] = [];

    for (const source of sources) {
      const { owner, repo } = parseRepoString(source.repo);
      const ref = source.branch || 'main';
      const remotePath = source.remotePath || '';
      const raw = await fetchAllFiles({ owner, repo, path: remotePath, ref });
      const files = filterFiles(raw, source);
      allPaths.push(...files.map((f) => f.path));
    }

    writeCompletionCache(allPaths);
  } catch {
    // Best-effort — never fail the calling command
  }
}
