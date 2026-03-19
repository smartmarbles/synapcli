import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('ora', () => ({
  default: () => ({
    start:   vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail:    vi.fn().mockReturnThis(),
    stop:    vi.fn().mockReturnThis(),
  }),
}));

vi.mock('../../lib/retry.js', () => ({
  withRetry: vi.fn((fn: () => unknown) => fn()),
  sleep:     vi.fn(),
}));

import { diffCommand }           from '../../commands/diff.js';
import { saveConfig, saveLock }  from '../../lib/config.js';
import type { SynapConfig }      from '../../types.js';

const OWNER    = 'acme';
const REPO     = 'agents';
const REPO_KEY = `${OWNER}/${REPO}`;
const BRANCH   = 'main';

function makeHeaders() {
  return { get: (h: string) => h === 'X-RateLimit-Remaining' ? '60' : '0' };
}

function makeListResponse(files: object[]) {
  return { ok: true, status: 200, headers: makeHeaders(), json: () => Promise.resolve(files) };
}

function makeFileResponse(path: string, sha: string, content: string) {
  return {
    ok: true, status: 200, headers: makeHeaders(),
    json: () => Promise.resolve({
      type: 'file', path, sha, size: content.length,
      encoding: 'base64',
      content: Buffer.from(content).toString('base64'),
    }),
  };
}

function makeErrorResponse(status: number) {
  return { ok: false, status, headers: makeHeaders(), json: () => Promise.resolve({ message: 'error' }) };
}

let testDir: string;
let consoleSpy: ReturnType<typeof vi.spyOn>;

const BASE_CONFIG: SynapConfig = {
  repo: `${OWNER}/${REPO}`, branch: BRANCH, remotePath: '', localOutput: '.',
};

beforeEach(() => {
  testDir = join(tmpdir(), `synap-diff-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(testDir);
  vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  });
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  saveConfig(BASE_CONFIG, testDir);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('diffCommand', () => {
  it('exits with code 2 when config file is missing', async () => {
    rmSync(join(testDir, 'synap.config.json'));
    await expect(diffCommand(undefined)).rejects.toThrow('exit:2');
  });

  it('exits with code 4 on network error fetching file list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(diffCommand(undefined)).rejects.toThrow('exit:4');
  });

  it('exits with code 4 on GitHub API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeErrorResponse(404)));
    await expect(diffCommand(undefined)).rejects.toThrow('exit:4');
  });

  it('skips fetching content when local SHA matches remote SHA', async () => {
    const remoteFiles = [{ type: 'file', path: 'summarizer.md', sha: 'sha-v1', size: 50 }];
    saveLock({ [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-v1', ref: BRANCH, pulledAt: new Date().toISOString() } }, testDir);

    const fetchMock = vi.fn().mockResolvedValueOnce(makeListResponse(remoteFiles));
    vi.stubGlobal('fetch', fetchMock);

    await diffCommand(undefined);

    // Only 1 fetch call (the file list) — content was not fetched because SHA matches
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows "new file" warning when file has not been pulled yet', async () => {
    const remoteFiles = [{ type: 'file', path: 'new-agent.md', sha: 'sha-new', size: 50 }];
    // No lock entry → SHA differs (no entry means no prior sha)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeListResponse(remoteFiles))
      .mockResolvedValueOnce(makeFileResponse('new-agent.md', 'sha-new', '# New Agent'));
    vi.stubGlobal('fetch', fetchMock);

    await diffCommand(undefined);

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('new file');
  });

  it('shows no diff output when local and remote content are identical', async () => {
    const content = '# Summarizer\nSummarizes text.';
    writeFileSync(join(testDir, 'summarizer.md'), content);
    const remoteFiles = [{ type: 'file', path: 'summarizer.md', sha: 'sha-v2', size: content.length }];
    saveLock({ [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-v1', ref: BRANCH, pulledAt: new Date().toISOString() } }, testDir);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeListResponse(remoteFiles))
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-v2', content))
    );

    await diffCommand(undefined);

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('up to date');
  });

  it('shows diff output when local and remote content differ', async () => {
    writeFileSync(join(testDir, 'summarizer.md'), '# Old Content');
    const remoteFiles = [{ type: 'file', path: 'summarizer.md', sha: 'sha-v2', size: 20 }];
    saveLock({ [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-v1', ref: BRANCH, pulledAt: new Date().toISOString() } }, testDir);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeListResponse(remoteFiles))
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-v2', '# New Content'))
    );

    await diffCommand(undefined);

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('summarizer.md');
  });

  it('reports "all files up to date" when nothing changed', async () => {
    const content = '# Content';
    writeFileSync(join(testDir, 'summarizer.md'), content);
    const remoteFiles = [{ type: 'file', path: 'summarizer.md', sha: 'sha-v1', size: content.length }];
    saveLock({ [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-v1', ref: BRANCH, pulledAt: new Date().toISOString() } }, testDir);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse(remoteFiles)));

    await diffCommand(undefined);

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output.toLowerCase()).toContain('up to date');
  });

  it('name filter only checks matching files', async () => {
    const remoteFiles = [
      { type: 'file', path: 'summarizer.md', sha: 'sha-v2', size: 20 },
      { type: 'file', path: 'classifier.md', sha: 'sha-v1', size: 20 },
    ];
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-v1', ref: BRANCH, pulledAt: new Date().toISOString() },
      [`${REPO_KEY}::classifier.md`]: { sha: 'sha-v1', ref: BRANCH, pulledAt: new Date().toISOString() },
    }, testDir);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeListResponse(remoteFiles))
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-v2', '# New'));
    vi.stubGlobal('fetch', fetchMock);

    await diffCommand('summarizer');

    // Only 2 fetches: list + summarizer content (classifier filtered out)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gracefully continues when a single file content fetch fails', async () => {
    const remoteFiles = [{ type: 'file', path: 'summarizer.md', sha: 'sha-v2', size: 20 }];
    saveLock({ [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-v1', ref: BRANCH, pulledAt: new Date().toISOString() } }, testDir);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeListResponse(remoteFiles))
      .mockResolvedValueOnce(makeErrorResponse(500))
    );

    // Should not throw — fetch error on content is handled gracefully
    await expect(diffCommand(undefined)).resolves.not.toThrow();
  });

  it('reports N file(s) differ when changes found', async () => {
    writeFileSync(join(testDir, 'summarizer.md'), '# Old');
    const remoteFiles = [{ type: 'file', path: 'summarizer.md', sha: 'sha-v2', size: 10 }];
    saveLock({ [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-v1', ref: BRANCH, pulledAt: new Date().toISOString() } }, testDir);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeListResponse(remoteFiles))
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-v2', '# New'))
    );

    await diffCommand(undefined);

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('differ');
  });
});
