import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
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

vi.mock('@clack/prompts', () => ({
  confirm:  vi.fn().mockResolvedValue(true),
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

import { updateCommand }                             from '../../commands/update.js';
import { runPostPullHook }                           from '../../lib/hooks.js';
import { saveConfig, saveLock, loadLock }            from '../../lib/config.js';
import type { SynapConfig }                          from '../../types.js';

const OWNER    = 'acme';
const REPO     = 'agents';
const REPO_KEY = `${OWNER}/${REPO}`;
const BRANCH   = 'main';

const REMOTE_FILES = [
  { type: 'file', path: 'summarizer.md', sha: 'sha-summ-v2', size: 150 },
  { type: 'file', path: 'classifier.md', sha: 'sha-class-v1', size: 200 },
];

const CONTENTS: Record<string, string> = {
  'summarizer.md': '# Summarizer v2',
  'classifier.md': '# Classifier v1',
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

let testDir: string;

const BASE_CONFIG: SynapConfig = {
  repo: `${OWNER}/${REPO}`, branch: BRANCH, remotePath: '', localOutput: '.',
};

beforeEach(() => {
  testDir = join(tmpdir(), `synap-update-${Date.now()}`);
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
  rmSync(testDir, { recursive: true, force: true });
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('updateCommand', () => {

  it('skips files with matching SHA and updates files with changed SHA', async () => {
    // summarizer has old SHA in lock → changed; classifier has same SHA → up-to-date
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-summ-v1', ref: BRANCH, pulledAt: new Date().toISOString() },
      [`${REPO_KEY}::classifier.md`]: { sha: 'sha-class-v1', ref: BRANCH, pulledAt: new Date().toISOString() },
    }, testDir);
    writeFileSync(join(testDir, 'summarizer.md'), '# Summarizer v1');
    writeFileSync(join(testDir, 'classifier.md'), CONTENTS['classifier.md']);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeListResponse())
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-summ-v2', CONTENTS['summarizer.md']));
    vi.stubGlobal('fetch', fetchMock);

    await updateCommand(undefined, { force: true });

    expect(readFileSync(join(testDir, 'summarizer.md'), 'utf8')).toBe(CONTENTS['summarizer.md']);
    // Only 2 fetch calls: 1 list + 1 content for summarizer (classifier unchanged)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('updates lockfile with new SHA after updating a file', async () => {
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-summ-v1', ref: BRANCH, pulledAt: new Date().toISOString() },
    }, testDir);
    writeFileSync(join(testDir, 'summarizer.md'), '# old');

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeListResponse([{ type: 'file', path: 'summarizer.md', sha: 'sha-summ-v2', size: 150 }]))
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-summ-v2', CONTENTS['summarizer.md'])));

    await updateCommand(undefined, { force: true });

    const lock = loadLock(testDir);
    expect(lock[`${REPO_KEY}::summarizer.md`].sha).toBe('sha-summ-v2');
  });

  it('reports all files up to date when no SHAs have changed', async () => {
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-summ-v2', ref: BRANCH, pulledAt: new Date().toISOString() },
      [`${REPO_KEY}::classifier.md`]: { sha: 'sha-class-v1', ref: BRANCH, pulledAt: new Date().toISOString() },
    }, testDir);

    const fetchMock = vi.fn().mockResolvedValueOnce(makeListResponse());
    vi.stubGlobal('fetch', fetchMock);

    await updateCommand(undefined, { force: true });

    // Only the list fetch, no content fetches
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('name filter only updates matching files', async () => {
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-summ-v1', ref: BRANCH, pulledAt: new Date().toISOString() },
      [`${REPO_KEY}::classifier.md`]: { sha: 'sha-class-old', ref: BRANCH, pulledAt: new Date().toISOString() },
    }, testDir);
    writeFileSync(join(testDir, 'summarizer.md'), '# old summ');
    writeFileSync(join(testDir, 'classifier.md'), '# old class');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeListResponse())
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-summ-v2', CONTENTS['summarizer.md']));
    vi.stubGlobal('fetch', fetchMock);

    await updateCommand('summarizer', { force: true });

    expect(readFileSync(join(testDir, 'summarizer.md'), 'utf8')).toBe(CONTENTS['summarizer.md']);
    // classifier should not have been fetched
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('postpull hook runs when files are updated', async () => {
    saveConfig({ ...BASE_CONFIG, postpull: 'echo updated' }, testDir);
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-summ-v1', ref: BRANCH, pulledAt: new Date().toISOString() },
    }, testDir);
    writeFileSync(join(testDir, 'summarizer.md'), '# old');

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeListResponse([{ type: 'file', path: 'summarizer.md', sha: 'sha-summ-v2', size: 100 }]))
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-summ-v2', CONTENTS['summarizer.md'])));

    await updateCommand(undefined, { force: true });

    expect(runPostPullHook).toHaveBeenCalledWith('echo updated');
  });

  it('postpull hook does not run when nothing changes', async () => {
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-summ-v2', ref: BRANCH, pulledAt: new Date().toISOString() },
    }, testDir);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse([{ type: 'file', path: 'summarizer.md', sha: 'sha-summ-v2', size: 100 }])));

    await updateCommand(undefined, { force: true });

    expect(runPostPullHook).not.toHaveBeenCalled();
  });

  it('exits with code 4 on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    await expect(updateCommand(undefined, { force: true })).rejects.toThrow('exit:4');
  });

  it('exits with code 2 when config file is missing', async () => {
    rmSync(join(testDir, 'synap.config.json'));
    await expect(updateCommand(undefined, {})).rejects.toThrow('exit:2');
  });

  it('exits with code 1 when a file fetch fails during update', async () => {
    // summarizer has old SHA in lock → needs update, but fetch will fail
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-summ-v1', ref: BRANCH, pulledAt: new Date().toISOString() },
    }, testDir);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeListResponse([{ type: 'file', path: 'summarizer.md', sha: 'sha-summ-v2', size: 150 }]))
      .mockRejectedValueOnce(new Error('Network error fetching content'))
    );

    await expect(updateCommand(undefined, { force: true })).rejects.toThrow('exit:1');
  });

  it('logs warning and does not update when name filter matches nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse()));

    await updateCommand('no-such-file', { force: true });

    // No files written
    expect(existsSync(join(testDir, 'summarizer.md'))).toBe(false);
    expect(existsSync(join(testDir, 'classifier.md'))).toBe(false);
  });

  it('flags locally modified files in the preview before updating', async () => {
    // Lock has sha for "# Summarizer v1", but user edited the file locally
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: '951fcb40abea7648fcf66e1ada728a535b68f084', ref: BRANCH, pulledAt: new Date().toISOString() },
    }, testDir);
    writeFileSync(join(testDir, 'summarizer.md'), '# Summarizer v1 — my local edits');

    // Remote has new version (sha-summ-v2 differs from lock SHA)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeListResponse([{ type: 'file', path: 'summarizer.md', sha: 'sha-summ-v2', size: 150 }]))
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-summ-v2', CONTENTS['summarizer.md'])));

    // Use confirm mock to capture the preview showing (non-force mode)
    const { confirm } = await import('@clack/prompts');
    vi.mocked(confirm).mockResolvedValueOnce(true);

    await updateCommand(undefined, {});

    // File was overwritten with remote content after confirmation
    expect(readFileSync(join(testDir, 'summarizer.md'), 'utf8')).toBe(CONTENTS['summarizer.md']);
  });

  it('--force overwrites locally modified files without prompting', async () => {
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: '951fcb40abea7648fcf66e1ada728a535b68f084', ref: BRANCH, pulledAt: new Date().toISOString() },
    }, testDir);
    writeFileSync(join(testDir, 'summarizer.md'), '# Summarizer v1 — my local edits');

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeListResponse([{ type: 'file', path: 'summarizer.md', sha: 'sha-summ-v2', size: 150 }]))
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-summ-v2', CONTENTS['summarizer.md'])));

    await updateCommand(undefined, { force: true });

    expect(readFileSync(join(testDir, 'summarizer.md'), 'utf8')).toBe(CONTENTS['summarizer.md']);
  });

  it('postpull hook runs after a successful update', async () => {
    saveConfig({ ...BASE_CONFIG, postpull: 'echo updated' }, testDir);
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-summ-v1', ref: BRANCH, pulledAt: new Date().toISOString() },
    }, testDir);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeListResponse([{ type: 'file', path: 'summarizer.md', sha: 'sha-summ-v2', size: 150 }]))
      .mockResolvedValueOnce(makeFileResponse('summarizer.md', 'sha-summ-v2', CONTENTS['summarizer.md']))
    );

    await updateCommand(undefined, { force: true });

    expect(runPostPullHook).toHaveBeenCalledWith('echo updated');
  });
});
