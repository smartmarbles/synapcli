import fetch from 'node-fetch';

const GITHUB_API = 'https://api.github.com';

/**
 * Build headers for GitHub API requests.
 * Automatically picks up GITHUB_TOKEN from env.
 */
function buildHeaders() {
  const headers = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'synapcli',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

/**
 * List the contents of a directory in a GitHub repo.
 */
export async function listRepoContents({ owner, repo, path = '', ref }) {
  const refParam = ref ? `?ref=${ref}` : '';
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}${refParam}`;
  const res = await fetch(url, { headers: buildHeaders() });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub API error ${res.status}: ${err.message || res.statusText}`);
  }

  return res.json();
}

/**
 * Fetch the raw content of a single file from a GitHub repo.
 * Returns the file content as a UTF-8 string.
 */
export async function fetchFileContent({ owner, repo, path, ref }) {
  const refParam = ref ? `?ref=${ref}` : '';
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}${refParam}`;
  const res = await fetch(url, { headers: buildHeaders() });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub API error ${res.status}: ${err.message || res.statusText}`);
  }

  const data = await res.json();

  if (data.encoding !== 'base64') {
    throw new Error(`Unexpected encoding: ${data.encoding}`);
  }

  return {
    content: Buffer.from(data.content, 'base64').toString('utf8'),
    sha: data.sha,
    size: data.size,
    downloadUrl: data.download_url,
  };
}

/**
 * Recursively fetch all files under a given repo path.
 * Returns a flat array of { path, sha } objects.
 */
export async function fetchAllFiles({ owner, repo, path = '', ref }) {
  const contents = await listRepoContents({ owner, repo, path, ref });
  const files = [];

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
