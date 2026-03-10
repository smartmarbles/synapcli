import fetch from 'node-fetch';
import { execSync } from 'child_process';
import type { RemoteFile, FetchedFile, RepoParams } from '../types.js';

const GITHUB_API = 'https://api.github.com';

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

function getToken(): string | undefined {
  // 1. Try OS environment variable first
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  // 2. Fall back to ~/.gitconfig via git CLI
  try {
    const token = execSync('git config --global synapcli.githubToken', {
      encoding: 'utf8',
    }).trim();
    if (token) return token;
  } catch {
    // key not set in .gitconfig, ignore
  }

  return undefined;
}

/**
 * Build headers for GitHub API requests.
 * Reads token from OS env or ~/.gitconfig [synapcli] githubToken.
 * If no token is found, requests are sent unauthenticated (public repos only).
 */
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

/**
 * List the contents of a directory in a GitHub repo.
 */
export async function listRepoContents({
  owner,
  repo,
  path = '',
  ref,
}: RepoParams): Promise<GitHubFileResponse[]> {
  const refParam = ref ? `?ref=${ref}` : '';
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}${refParam}`;
  const res = await fetch(url, { headers: buildHeaders() });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as GitHubErrorBody;
    throw new Error(`GitHub API error ${res.status}: ${err.message ?? res.statusText}`);
  }

  return res.json() as Promise<GitHubFileResponse[]>;
}

/**
 * Fetch the raw content of a single file from a GitHub repo.
 * Returns the decoded UTF-8 content, SHA, size, and download URL.
 */
export async function fetchFileContent({
  owner,
  repo,
  path,
  ref,
}: RepoParams): Promise<FetchedFile> {
  const refParam = ref ? `?ref=${ref}` : '';
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}${refParam}`;
  const res = await fetch(url, { headers: buildHeaders() });

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

/**
 * Recursively fetch all files under a given repo path.
 * Returns a flat array of RemoteFile objects.
 */
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