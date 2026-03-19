import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
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

vi.mock('../../lib/completionCache.js', () => ({ writeCompletionCache: vi.fn() }));
vi.mock('../../lib/retry.js', () => ({
  withRetry: vi.fn((fn: () => unknown) => fn()),
  sleep:     vi.fn(),
}));

import { listCommand }                         from '../../commands/list.js';
import { writeCompletionCache }                from '../../lib/completionCache.js';
import { saveConfig }                          from '../../lib/config.js';
import type { SynapConfig }                    from '../../types.js';

const OWNER    = 'acme';
const REPO     = 'agents';
const BRANCH   = 'main';

const REMOTE_FILES = [
  { type: 'file', path: 'summarizer.md', sha: 'sha-summ', size: 150 },
  { type: 'file', path: 'classifier.md', sha: 'sha-class', size: 2048 },
  { type: 'file', path: 'large-agent.md', sha: 'sha-large', size: 1200000 },
];

function makeHeaders() {
  return { get: (h: string) => h === 'X-RateLimit-Remaining' ? '60' : '0' };
}

function makeListResponse(files = REMOTE_FILES) {
  return { ok: true, status: 200, headers: makeHeaders(), json: () => Promise.resolve(files) };
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
  testDir = join(tmpdir(), `synap-list-${Date.now()}`);
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

describe('listCommand', () => {

  it('fetches and outputs file list in human-readable format', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse()));

    await listCommand({});

    // Should have printed file names
    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('summarizer.md');
    expect(output).toContain('classifier.md');
  });

  it('formats file sizes correctly (B, KB, MB)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse()));

    await listCommand({});

    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('150B');
    expect(output).toContain('2.0KB');
    expect(output).toContain('1.1MB');
  });

  it('--json outputs raw JSON without formatting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse()));

    await listCommand({ json: true });

    const jsonCall = consoleSpy.mock.calls.find(c => {
      try { JSON.parse(c[0]); return true; } catch { return false; }
    });
    expect(jsonCall).toBeDefined();

    const parsed = JSON.parse(jsonCall![0]);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].files).toHaveLength(REMOTE_FILES.length);
  });

  it('populates completion cache with file paths', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse()));

    await listCommand({});

    expect(writeCompletionCache).toHaveBeenCalledWith(
      expect.arrayContaining(['summarizer.md', 'classifier.md', 'large-agent.md'])
    );
  });

  it('applies include/exclude glob filters', async () => {
    saveConfig({
      sources: [{
        name: 'Agents', repo: `${OWNER}/${REPO}`, branch: BRANCH,
        remotePath: '', localOutput: '.',
        include: ['summarizer*'],
      }],
    }, testDir);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse()));

    await listCommand({});

    const output = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('summarizer.md');
    expect(output).not.toContain('classifier.md');
  });

  it('exits with code 4 on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    await expect(listCommand({})).rejects.toThrow('exit:4');
  });

  it('exits with code 4 on GitHub 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeErrorResponse(404)));
    await expect(listCommand({})).rejects.toThrow('exit:4');
  });

  it('exits with code 2 when config file is missing', async () => {
    const { rmSync: rm } = await import('fs');
    rm(join(testDir, 'synap.config.json'));
    await expect(listCommand({})).rejects.toThrow('exit:2');
  });

  it('shows "No files found" warning when source returns empty file list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeListResponse([])));

    await listCommand({});

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('No files found');
  });

  it('multi-source config lists files from each source separately', async () => {
    saveConfig({
      sources: [
        { name: 'Agents',  repo: `${OWNER}/${REPO}`,  branch: BRANCH, remotePath: '', localOutput: '.' },
        { name: 'Prompts', repo: 'acme/prompts', branch: BRANCH, remotePath: '', localOutput: '.' },
      ],
    }, testDir);

    const agentFiles   = [{ type: 'file', path: 'agent.md',  sha: 'sha1', size: 10 }];
    const promptFiles  = [{ type: 'file', path: 'prompt.md', sha: 'sha2', size: 20 }];

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeListResponse(agentFiles))
      .mockResolvedValueOnce(makeListResponse(promptFiles))
    );

    await listCommand({});

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('agent.md');
    expect(output).toContain('prompt.md');
  });
});
