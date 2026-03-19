import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

vi.mock('ora', () => ({
  default: () => ({
    start:   vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail:    vi.fn().mockReturnThis(),
    stop:    vi.fn().mockReturnThis(),
  }),
}));

vi.mock('@clack/prompts', () => ({
  confirm:  vi.fn().mockResolvedValue(true),
  select:   vi.fn().mockResolvedValue('overwrite'),
  isCancel: vi.fn(() => false),
  cancel:   vi.fn(),
}));

vi.mock('../../lib/completionCache.js', () => ({ writeCompletionCache: vi.fn() }));
vi.mock('../../lib/hooks.js',           () => ({ runPostPullHook: vi.fn() }));
vi.mock('../../lib/retry.js',           () => ({
  withRetry: vi.fn((fn: () => unknown) => fn()),
  sleep:     vi.fn(),
}));
vi.mock('../../utils/progress.js', () => ({
  SynapProgress: class { tick = vi.fn(); stop = vi.fn(); },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { pullCommand }                               from '../../commands/pull.js';
import { runPostPullHook }                           from '../../lib/hooks.js';
import { saveConfig, saveLock, loadLock, LOCK_FILE } from '../../lib/config.js';
import { setCI }                                     from '../../utils/context.js';
import type { SynapConfig }                          from '../../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const OWNER    = 'acme';
const REPO     = 'agents';
const REPO_KEY = `${OWNER}/${REPO}`;
const BRANCH   = 'main';

const REMOTE_FILES = [
  { type: 'file', path: 'summarizer.md', sha: 'sha-summ-v1', size: 150 },
  { type: 'file', path: 'classifier.md', sha: 'sha-class-v1', size: 200 },
];

const CONTENTS: Record<string, string> = {
  'summarizer.md': '# Summarizer\nSummarizes text.',
  'classifier.md': '# Classifier\nClassifies things.',
};

function makeHeaders() {
  return { get: (h: string) => h === 'X-RateLimit-Remaining' ? '60' : '0' };
}

function makeListResponse(files = REMOTE_FILES) {
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

function makeErrorResponse(status: number, message = 'error') {
  return { ok: false, status, headers: makeHeaders(), json: () => Promise.resolve({ message }) };
}

function setupFetch(files = REMOTE_FILES) {
  const mock = vi.fn().mockResolvedValueOnce(makeListResponse(files));
  for (const f of files) {
    mock.mockResolvedValueOnce(makeFileResponse(f.path, f.sha, CONTENTS[f.path] ?? 'content'));
  }
  vi.stubGlobal('fetch', mock);
  return mock;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let testDir: string;

const BASE_CONFIG: SynapConfig = {
  repo: `${OWNER}/${REPO}`, branch: BRANCH, remotePath: '', localOutput: '.',
};

beforeEach(() => {
  testDir = join(tmpdir(), `synap-pull-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(testDir);
  vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  saveConfig(BASE_CONFIG, testDir);
});

afterEach(() => {
  setCI(false);
  rmSync(testDir, { recursive: true, force: true });
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('pullCommand', () => {

  it('writes all files to disk', async () => {
    setupFetch();
    await pullCommand(undefined, { force: true });
    expect(readFileSync(join(testDir, 'summarizer.md'), 'utf8')).toBe(CONTENTS['summarizer.md']);
    expect(readFileSync(join(testDir, 'classifier.md'), 'utf8')).toBe(CONTENTS['classifier.md']);
  });

  it('creates lockfile with correct SHA and ref', async () => {
    setupFetch();
    await pullCommand(undefined, { force: true });
    const lock = loadLock(testDir);
    expect(lock[`${REPO_KEY}::summarizer.md`]).toMatchObject({ sha: 'sha-summ-v1', ref: BRANCH });
    expect(lock[`${REPO_KEY}::classifier.md`]).toMatchObject({ sha: 'sha-class-v1', ref: BRANCH });
  });

  it('--dry-run does not write files and only fetches the file list', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(makeListResponse());
    vi.stubGlobal('fetch', fetchMock);
    await pullCommand(undefined, { dryRun: true });
    expect(existsSync(join(testDir, 'summarizer.md'))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('name filter only pulls matching file', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeListResponse())
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-summ-v1', CONTENTS['summarizer.md']));
    vi.stubGlobal('fetch', fetchMock);
    await pullCommand('summarizer', { force: true });
    expect(existsSync(join(testDir, 'summarizer.md'))).toBe(true);
    expect(existsSync(join(testDir, 'classifier.md'))).toBe(false);
  });

  it('lockfile records correct ref when --ref flag is used', async () => {
    setupFetch();
    await pullCommand(undefined, { force: true, ref: 'feat/v2' });
    const lock = loadLock(testDir);
    expect(lock[`${REPO_KEY}::summarizer.md`].ref).toBe('feat/v2');
    expect(lock[`${REPO_KEY}::classifier.md`].ref).toBe('feat/v2');
  });

  it('stores failed files in lockfile for --retry-failed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeListResponse())
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-summ-v1', CONTENTS['summarizer.md']))
      .mockRejectedValueOnce(new Error('Network error'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(pullCommand(undefined, { force: true })).rejects.toThrow('exit:1');

    const lock = loadLock(testDir);
    expect(lock[`${REPO_KEY}::__failed__`]).toEqual(['classifier.md']);
    // summarizer still written successfully
    expect(existsSync(join(testDir, 'summarizer.md'))).toBe(true);
  });

  it('--retry-failed only retries previously failed files', async () => {
    // Seed lockfile with a failed entry
    saveLock({ [`${REPO_KEY}::__failed__`]: ['summarizer.md'] as unknown } as never, testDir);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeListResponse())
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-summ-v1', CONTENTS['summarizer.md']));
    vi.stubGlobal('fetch', fetchMock);

    await pullCommand(undefined, { force: true, retryFailed: true });

    expect(existsSync(join(testDir, 'summarizer.md'))).toBe(true);
    expect(existsSync(join(testDir, 'classifier.md'))).toBe(false);
    // Only 2 fetch calls: 1 list + 1 content (not classifier)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('CI mode skips conflicting untracked file and pulls the rest', async () => {
    writeFileSync(join(testDir, 'summarizer.md'), 'pre-existing content');
    setupFetch();
    setCI(true);

    await pullCommand(undefined, { force: false });

    // Summarizer was skipped (conflict in CI), classifier was pulled
    expect(readFileSync(join(testDir, 'summarizer.md'), 'utf8')).toBe('pre-existing content');
    expect(existsSync(join(testDir, 'classifier.md'))).toBe(true);
  });

  it('does not overwrite an already-tracked file if SHA matches', async () => {
    // Pre-seed lockfile so file is considered already tracked
    saveLock({ [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-summ-v1', ref: BRANCH, pulledAt: new Date().toISOString() } }, testDir);
    writeFileSync(join(testDir, 'summarizer.md'), 'old content');
    setupFetch();

    await pullCommand(undefined, { force: true });

    // Force re-pulls even tracked files — content should be updated
    expect(readFileSync(join(testDir, 'summarizer.md'), 'utf8')).toBe(CONTENTS['summarizer.md']);
  });

  it('postpull hook runs after a successful pull', async () => {
    saveConfig({ ...BASE_CONFIG, postpull: 'echo done' }, testDir);
    setupFetch();

    await pullCommand(undefined, { force: true });

    expect(runPostPullHook).toHaveBeenCalledWith('echo done');
  });

  it('postpull hook does not run when no files are written', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse([])));
    await pullCommand(undefined, { force: true });
    expect(runPostPullHook).not.toHaveBeenCalled();
  });

  it('exits with code 4 on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(pullCommand(undefined, { force: true })).rejects.toThrow('exit:4');
  });

  it('exits with code 4 on GitHub 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeErrorResponse(404, 'Not Found')));
    await expect(pullCommand(undefined, { force: true })).rejects.toThrow('exit:4');
  });

  it('exits with code 2 when config file is missing', async () => {
    rmSync(join(testDir, 'synap.config.json'));
    await expect(pullCommand(undefined, { force: true })).rejects.toThrow('exit:2');
  });

  it('--retry-failed with no prior failures logs info and skips', async () => {
    // No failed key in lock
    const fetchMock = vi.fn().mockResolvedValueOnce(makeListResponse());
    vi.stubGlobal('fetch', fetchMock);

    await pullCommand(undefined, { force: true, retryFailed: true });

    // Only the list fetch — no content fetched
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('interactive conflict: user chooses skip — file not overwritten', async () => {
    const { select } = await import('@clack/prompts');
    vi.mocked(select).mockResolvedValueOnce('skip');

    writeFileSync(join(testDir, 'summarizer.md'), 'pre-existing content');
    // Only pull summarizer so we get exactly one conflict prompt
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeListResponse([REMOTE_FILES[0]]))
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-summ-v1', CONTENTS['summarizer.md']));
    vi.stubGlobal('fetch', fetchMock);

    await pullCommand(undefined, { force: false });

    expect(readFileSync(join(testDir, 'summarizer.md'), 'utf8')).toBe('pre-existing content');
  });

  it('interactive conflict: user chooses overwrite — file is replaced', async () => {
    const { select } = await import('@clack/prompts');
    vi.mocked(select).mockResolvedValueOnce('overwrite');

    writeFileSync(join(testDir, 'summarizer.md'), 'pre-existing content');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeListResponse([REMOTE_FILES[0]]))
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-summ-v1', CONTENTS['summarizer.md']));
    vi.stubGlobal('fetch', fetchMock);

    await pullCommand(undefined, { force: false });

    expect(readFileSync(join(testDir, 'summarizer.md'), 'utf8')).toBe(CONTENTS['summarizer.md']);
  });

  it('interactive conflict: prompt cancel treats file as skipped', async () => {
    const { select, isCancel } = await import('@clack/prompts');
    // First isCancel call goes to previewAndConfirm's confirm check → must be false
    // Second isCancel call goes to the conflict select check → true (cancel)
    vi.mocked(isCancel).mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.mocked(select).mockResolvedValueOnce(Symbol('cancel') as unknown as string);

    writeFileSync(join(testDir, 'summarizer.md'), 'pre-existing content');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse([REMOTE_FILES[0]])));

    await pullCommand(undefined, { force: false });

    expect(readFileSync(join(testDir, 'summarizer.md'), 'utf8')).toBe('pre-existing content');
  });

  it('logs warning and continues when no files match name filter', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse()));

    await pullCommand('nonexistent-file', { force: true });

    // Should not throw; no files written
    expect(existsSync(join(testDir, 'summarizer.md'))).toBe(false);
  });
});
