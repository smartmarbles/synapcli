import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// Mock retry so withRetry is a transparent passthrough that also invokes onRetry
vi.mock('../lib/retry.js', () => ({
  withRetry: vi.fn(async (
    fn: () => unknown,
    _retries: number,
    onRetry: (attempt: number, err: Error) => void
  ) => {
    // Exercise the retry callback (covers the log.warn line inside githubFetch)
    onRetry(1, new Error('transient'));
    return fn();
  }),
  sleep: vi.fn(),
}));

import { execSync }             from 'child_process';
import { sleep }                from '../lib/retry.js';
import {
  listRepoContents,
  fetchFileContent,
  fetchAllFiles,
  validateToken,
  hasToken,
} from '../lib/github.js';

function makeHeaders(remaining = 60, reset = 0) {
  return {
    get: (h: string) => {
      if (h === 'X-RateLimit-Remaining') return String(remaining);
      if (h === 'X-RateLimit-Reset')     return String(reset);
      return '0';
    },
  };
}

function okListResponse(files: object[] = []) {
  return { ok: true, status: 200, headers: makeHeaders(), json: () => Promise.resolve(files) };
}

function errorResponse(status: number, message = 'error') {
  return { ok: false, status, statusText: 'Error', headers: makeHeaders(), json: () => Promise.resolve({ message }) };
}

function fileApiResponse(path: string, sha: string, content: string) {
  return {
    ok: true, status: 200, headers: makeHeaders(),
    json: () => Promise.resolve({
      type: 'file', path, sha, size: content.length,
      encoding: 'base64',
      content: Buffer.from(content).toString('base64'),
    }),
  };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ── Token resolution ──────────────────────────────────────────────────────────

describe('hasToken', () => {
  it('returns true when GITHUB_TOKEN env var is set', () => {
    process.env.GITHUB_TOKEN = 'env-token';
    expect(hasToken()).toBe(true);
  });

  it('returns true when git config returns a token', () => {
    vi.mocked(execSync).mockReturnValue('gitconfig-token\n' as unknown as Buffer);
    expect(hasToken()).toBe(true);
  });

  it('returns false when no env var and git config throws', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('not set'); });
    expect(hasToken()).toBe(false);
  });

  it('returns false when git config returns empty string', () => {
    vi.mocked(execSync).mockReturnValue('\n' as unknown as Buffer);
    expect(hasToken()).toBe(false);
  });
});

// ── Rate-limit handling ───────────────────────────────────────────────────────

describe('rate limit handling', () => {
  it('calls sleep when rate limit remaining is 0', async () => {
    const futureReset = Math.floor((Date.now() + 10_000) / 1000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      headers: makeHeaders(0, futureReset),
      json: () => Promise.resolve([]),
    }));
    await listRepoContents({ owner: 'a', repo: 'b' });
    expect(sleep).toHaveBeenCalled();
  });

  it('logs warning when remaining is below threshold (< 10)', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      headers: makeHeaders(5),
      json: () => Promise.resolve([]),
    }));
    await listRepoContents({ owner: 'a', repo: 'b' });
    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('rate limit low');
  });

  it('does not warn when remaining is comfortably above threshold', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okListResponse()));
    await listRepoContents({ owner: 'a', repo: 'b' });
    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).not.toContain('rate limit');
  });
});

// ── listRepoContents ──────────────────────────────────────────────────────────

describe('listRepoContents', () => {
  it('returns parsed file list on success', async () => {
    const files = [{ type: 'file', path: 'a.md', sha: 'sha1', size: 100 }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okListResponse(files)));
    const result = await listRepoContents({ owner: 'acme', repo: 'agents' });
    expect(result).toEqual(files);
  });

  it('appends ref as query param when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okListResponse());
    vi.stubGlobal('fetch', fetchMock);
    await listRepoContents({ owner: 'a', repo: 'b', ref: 'feat/v2' });
    expect(fetchMock.mock.calls[0][0]).toContain('?ref=feat/v2');
  });

  it('throws auth error with helpful message on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(errorResponse(401, 'Bad credentials')));
    await expect(listRepoContents({ owner: 'a', repo: 'b' })).rejects.toThrow(/auth error 401/i);
  });

  it('throws auth error on 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(errorResponse(403, 'Forbidden')));
    await expect(listRepoContents({ owner: 'a', repo: 'b' })).rejects.toThrow(/403/);
  });

  it('throws generic API error on other non-ok responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(errorResponse(404, 'Not Found')));
    await expect(listRepoContents({ owner: 'a', repo: 'b' })).rejects.toThrow(/404/);
  });

  it('includes Authorization header when token is set', async () => {
    process.env.GITHUB_TOKEN = 'my-token';
    const fetchMock = vi.fn().mockResolvedValueOnce(okListResponse());
    vi.stubGlobal('fetch', fetchMock);
    await listRepoContents({ owner: 'a', repo: 'b' });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer my-token');
  });

  it('omits Authorization header when no token', async () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('no token'); });
    const fetchMock = vi.fn().mockResolvedValueOnce(okListResponse());
    vi.stubGlobal('fetch', fetchMock);
    await listRepoContents({ owner: 'a', repo: 'b' });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});

// ── fetchFileContent ──────────────────────────────────────────────────────────

describe('fetchFileContent', () => {
  it('decodes base64 content and returns sha + size', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      fileApiResponse('a.md', 'sha-abc', '# Hello')
    ));
    const result = await fetchFileContent({ owner: 'a', repo: 'b', path: 'a.md' });
    expect(result.content).toBe('# Hello');
    expect(result.sha).toBe('sha-abc');
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(errorResponse(404, 'Not Found')));
    await expect(fetchFileContent({ owner: 'a', repo: 'b', path: 'missing.md' })).rejects.toThrow(/404/);
  });

  it('throws when encoding is not base64', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, headers: makeHeaders(),
      json: () => Promise.resolve({ type: 'file', path: 'a.md', sha: 'sha', size: 5, encoding: 'utf-8', content: 'hello' }),
    }));
    await expect(fetchFileContent({ owner: 'a', repo: 'b', path: 'a.md' })).rejects.toThrow(/encoding/);
  });

  it('returns empty string for an empty file (content: "")', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, headers: makeHeaders(),
      json: () => Promise.resolve({ type: 'file', path: '__init__.py', sha: 'sha', size: 0, encoding: 'base64', content: '' }),
    }));
    const result = await fetchFileContent({ owner: 'a', repo: 'b', path: '__init__.py' });
    expect(result.content).toBe('');
    expect(result.sha).toBe('sha');
  });

  it('returns empty string when content field is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, headers: makeHeaders(),
      json: () => Promise.resolve({ type: 'file', path: 'a.md', sha: 'sha', size: 0, encoding: 'base64' }),
    }));
    const result = await fetchFileContent({ owner: 'a', repo: 'b', path: 'a.md' });
    expect(result.content).toBe('');
  });
});

// ── fetchAllFiles ─────────────────────────────────────────────────────────────

describe('fetchAllFiles', () => {
  it('returns flat list of files', async () => {
    const files = [
      { type: 'file', path: 'a.md', sha: 'sha1', size: 10 },
      { type: 'file', path: 'b.md', sha: 'sha2', size: 20 },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okListResponse(files)));
    const result = await fetchAllFiles({ owner: 'a', repo: 'b' });
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.path)).toEqual(['a.md', 'b.md']);
  });

  it('recursively fetches files inside subdirectories', async () => {
    const rootContents  = [
      { type: 'dir',  path: 'subdir', sha: 'sha-dir', size: 0 },
      { type: 'file', path: 'root.md', sha: 'sha-root', size: 5 },
    ];
    const subdirContents = [
      { type: 'file', path: 'subdir/nested.md', sha: 'sha-nested', size: 8 },
    ];
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okListResponse(rootContents))
      .mockResolvedValueOnce(okListResponse(subdirContents))
    );
    const result = await fetchAllFiles({ owner: 'a', repo: 'b' });
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.path)).toContain('subdir/nested.md');
    expect(result.map((f) => f.path)).toContain('root.md');
  });

  it('ignores non-file, non-dir items', async () => {
    const contents = [
      { type: 'symlink', path: 'link', sha: 'sha-link', size: 0 },
      { type: 'file',    path: 'real.md', sha: 'sha-real', size: 5 },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okListResponse(contents)));
    const result = await fetchAllFiles({ owner: 'a', repo: 'b' });
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('real.md');
  });
});

// ── validateToken ─────────────────────────────────────────────────────────────

describe('validateToken', () => {
  it('returns the authenticated username on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, headers: makeHeaders(),
      json: () => Promise.resolve({ login: 'alice' }),
    }));
    const username = await validateToken();
    expect(username).toBe('alice');
  });

  it('throws with invalid/expired message on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false, status: 401, statusText: 'Unauthorized', headers: makeHeaders(),
      json: () => Promise.resolve({}),
    }));
    await expect(validateToken()).rejects.toThrow(/invalid or expired/i);
  });

  it('throws with status info on other non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false, status: 500, statusText: 'Internal Server Error', headers: makeHeaders(),
      json: () => Promise.resolve({}),
    }));
    await expect(validateToken()).rejects.toThrow(/500/);
  });
});
