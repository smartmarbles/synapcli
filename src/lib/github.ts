import fetch, { type Response } from 'node-fetch';
import { execSync } from 'child_process';
import { withRetry, sleep } from '../lib/retry.js';
import { log } from '../utils/logger.js';
import { ExitCode } from '../types.js';
import type { RemoteFile, FetchedFile, RepoParams } from '../types.js';

const GITHUB_API = 'https://api.github.com';

// Warn when fewer than this many requests remain before reset
const RATE_LIMIT_WARN_THRESHOLD = 10;

interface GitHubErrorBody {
  message?: string;
}

interface GitHubFileResponse {
  type: string;
  path: string;
  sha: string;
  size: number;
  encoding?: string;
  content?: string;
  download_url?: string;
}

// ─── Token ────────────────────────────────────────────────────────────────────

function getToken(): string | undefined {
  // 1. OS environment variable
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  // 2. ~/.gitconfig [synapcli] githubToken
  try {
    const token = execSync('git config --global synapcli.githubToken', {
      encoding: 'utf8',
    }).trim();
    if (token) return token;
  } catch {
    // not configured — fine for public repos
  }

  return undefined;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'synapcli',
  };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

// ─── Rate limit ───────────────────────────────────────────────────────────────

async function handleRateLimit(res: Response): Promise<void> {
  const remaining = parseInt(res.headers.get('X-RateLimit-Remaining') ?? '60', 10);
  const resetAt   = parseInt(res.headers.get('X-RateLimit-Reset')     ?? '0',  10) * 1000;

  if (remaining === 0) {
    const waitMs = Math.max(resetAt - Date.now(), 0) + 1000;
    log.warn(`GitHub rate limit reached. Waiting ${Math.ceil(waitMs / 1000)}s for reset...`);
    await sleep(waitMs);
    return;
  }

  if (remaining < RATE_LIMIT_WARN_THRESHOLD) {
    log.warn(`GitHub rate limit low: ${remaining} requests remaining.`);
  }
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function githubFetch(url: string): Promise<Response> {
  return withRetry(
    async () => {
      const res = await fetch(url, { headers: buildHeaders() });
      await handleRateLimit(res);
      return res;
    },
    3,
    (attempt, err) => log.warn(`Request failed (attempt ${attempt}/3): ${err.message} — retrying...`)
  );
}

export async function listRepoContents({
  owner,
  repo,
  path = '',
  ref,
}: RepoParams): Promise<GitHubFileResponse[]> {
  const refParam = ref ? `?ref=${ref}` : '';
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}${refParam}`;
  const res = await githubFetch(url);

  if (res.status === 401 || res.status === 403) {
    const err = (await res.json().catch(() => ({}))) as GitHubErrorBody;
    const msg = `GitHub auth error ${res.status}: ${err.message ?? res.statusText}. Check your token has "Contents: Read-only" permission.`;
    throw Object.assign(new Error(msg), { exitCode: ExitCode.AuthError });
  }

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as GitHubErrorBody;
    throw Object.assign(
      new Error(`GitHub API error ${res.status}: ${err.message ?? res.statusText}`),
      { exitCode: ExitCode.NetworkError }
    );
  }

  return res.json() as Promise<GitHubFileResponse[]>;
}

export async function fetchFileContent({
  owner,
  repo,
  path,
  ref,
}: RepoParams): Promise<FetchedFile> {
  const refParam = ref ? `?ref=${ref}` : '';
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}${refParam}`;
  const res = await githubFetch(url);

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as GitHubErrorBody;
    throw new Error(`GitHub API error ${res.status}: ${err.message ?? res.statusText}`);
  }

  const data = (await res.json()) as GitHubFileResponse;

  if (data.encoding !== 'base64' || !data.content) {
    throw new Error(`Unexpected encoding: ${data.encoding}`);
  }

  return {
    content: Buffer.from(data.content, 'base64').toString('utf8'),
    sha: data.sha,
    size: data.size,
    downloadUrl: data.download_url ?? '',
  };
}

export async function fetchAllFiles({
  owner,
  repo,
  path = '',
  ref,
}: RepoParams): Promise<RemoteFile[]> {
  const contents = await listRepoContents({ owner, repo, path, ref });
  const files: RemoteFile[] = [];

  for (const item of contents) {
    if (item.type === 'file') {
      files.push({ path: item.path, sha: item.sha, size: item.size });
    } else if (item.type === 'dir') {
      const nested = await fetchAllFiles({ owner, repo, path: item.path, ref });
      files.push(...nested);
    }
  }

  return files;
}

/**
 * Validate that a token is working by calling GET /user.
 * Returns the authenticated username, or throws on failure.
 */
export async function validateToken(): Promise<string> {
  const res = await fetch(`${GITHUB_API}/user`, { headers: buildHeaders() });

  if (res.status === 401) {
    throw Object.assign(
      new Error('Token is invalid or expired.'),
      { exitCode: ExitCode.AuthError }
    );
  }
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as { login: string };
  return data.login;
}

/**
 * Check if a token is configured (env or gitconfig).
 */
export function hasToken(): boolean {
  return getToken() !== undefined;
}
