import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

import { statusCommand }                from '../../commands/status.js';
import { saveConfig, saveLock }         from '../../lib/config.js';
import type { SynapConfig }             from '../../types.js';

const OWNER    = 'acme';
const REPO     = 'agents';
const REPO_KEY = `${OWNER}/${REPO}`;
const BRANCH   = 'main';

const REMOTE_FILES = [
  { type: 'file', path: 'summarizer.md', sha: 'sha-summ-v2', size: 150 },
  { type: 'file', path: 'classifier.md', sha: 'sha-class-v1', size: 200 },
  { type: 'file', path: 'new-agent.md',  sha: 'sha-new',     size: 100 },
];

function makeHeaders() {
  return { get: (h: string) => h === 'X-RateLimit-Remaining' ? '60' : '0' };
}

function makeListResponse(files = REMOTE_FILES) {
  return { ok: true, status: 200, headers: makeHeaders(), json: () => Promise.resolve(files) };
}

let testDir: string;
let consoleSpy: ReturnType<typeof vi.spyOn>;

const BASE_CONFIG: SynapConfig = {
  repo: `${OWNER}/${REPO}`, branch: BRANCH, remotePath: '', localOutput: '.',
};

beforeEach(() => {
  testDir = join(tmpdir(), `synap-status-${Date.now()}`);
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
  vi.unstubAllGlobals();
});

describe('statusCommand', () => {

  it('shows not-pulled for files with no lock entry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse([
      { type: 'file', path: 'summarizer.md', sha: 'sha-summ-v2', size: 150 },
    ])));

    await statusCommand();

    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('summarizer.md');
    // No lock entry → not-pulled group
    expect(output.toLowerCase()).toMatch(/not.*(yet.)?pull/);
  });

  it('shows up-to-date for files where lock SHA matches remote SHA', async () => {
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-summ-v2', ref: BRANCH, pulledAt: new Date().toISOString() },
    }, testDir);
    writeFileSync(join(testDir, 'summarizer.md'), '# content');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse([
      { type: 'file', path: 'summarizer.md', sha: 'sha-summ-v2', size: 150 },
    ])));

    await statusCommand();

    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('summarizer.md');
    expect(output.toLowerCase()).toContain('up to date');
  });

  it('shows changed for files where lock SHA differs from remote SHA', async () => {
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-summ-v1', ref: BRANCH, pulledAt: new Date().toISOString() },
    }, testDir);
    writeFileSync(join(testDir, 'summarizer.md'), '# old content');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse([
      { type: 'file', path: 'summarizer.md', sha: 'sha-summ-v2', size: 150 },
    ])));

    await statusCommand();

    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('summarizer.md');
    expect(output.toLowerCase()).toContain('changed');
  });

  it('shows missing-locally for files with lock entry but deleted from disk', async () => {
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-summ-v2', ref: BRANCH, pulledAt: new Date().toISOString() },
    }, testDir);
    // File NOT written to disk

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse([
      { type: 'file', path: 'summarizer.md', sha: 'sha-summ-v2', size: 150 },
    ])));

    await statusCommand();

    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('summarizer.md');
    expect(output.toLowerCase()).toContain('missing');
  });

  it('correctly categorises multiple files across all four states', async () => {
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-summ-v1', ref: BRANCH, pulledAt: new Date().toISOString() }, // changed
      [`${REPO_KEY}::classifier.md`]: { sha: 'sha-class-v1', ref: BRANCH, pulledAt: new Date().toISOString() }, // missing-locally
    }, testDir);
    // summarizer on disk with old content (SHA mismatch → changed)
    writeFileSync(join(testDir, 'summarizer.md'), '# old');
    // classifier NOT on disk but in lock (missing-locally)
    // new-agent not in lock (not-pulled)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse()));

    await statusCommand();

    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output.toLowerCase()).toContain('changed');
    expect(output.toLowerCase()).toContain('missing');
    expect(output.toLowerCase()).toMatch(/not.*(yet.)?pull/);
  });

  it('exits with code 4 on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    await expect(statusCommand()).rejects.toThrow('exit:4');
  });

  it('exits with code 2 when config file is missing', async () => {
    rmSync(join(testDir, 'synap.config.json'));
    await expect(statusCommand()).rejects.toThrow('exit:2');
  });

  it('warns when no files are found across all sources', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse([])));

    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output.toLowerCase()).toContain('no files found');
  });

  it('shows "pending pull" summary when some files are not-pulled', async () => {
    // No lock entries → all files are not-pulled
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse([
      { type: 'file', path: 'summarizer.md', sha: 'sha-v1', size: 100 },
    ])));

    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output.toLowerCase()).toContain('not yet pulled');
  });

  it('shows "everything up to date" summary when all files match', async () => {
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { sha: 'sha-v1', ref: BRANCH, pulledAt: new Date().toISOString() },
    }, testDir);
    writeFileSync(join(testDir, 'summarizer.md'), '# content');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse([
      { type: 'file', path: 'summarizer.md', sha: 'sha-v1', size: 100 },
    ])));

    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output.toLowerCase()).toContain('up to date');
  });
});
