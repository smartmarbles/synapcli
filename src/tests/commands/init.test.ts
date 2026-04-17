import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
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
  intro:    vi.fn(),
  outro:    vi.fn(),
  confirm:  vi.fn(),
  cancel:   vi.fn(),
  isCancel: vi.fn(() => false),
}));

vi.mock('../../lib/sourcePrompt.js', () => ({
  promptSource: vi.fn(),
}));

// completionCommand is called at the end of init — mock it to avoid recursion
vi.mock('../../commands/completion.js', () => ({
  completionCommand: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/retry.js', () => ({
  withRetry: vi.fn((fn: () => unknown) => fn()),
  sleep:     vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../lib/completionCache.js', () => ({ refreshCompletionCache: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../../utils/files.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/files.js')>();
  return { ...actual };
});

import { execSync }      from 'child_process';
import * as p            from '@clack/prompts';
import { initCommand }   from '../../commands/init.js';
import { promptSource }  from '../../lib/sourcePrompt.js';
import { completionCommand } from '../../commands/completion.js';
import { loadConfig, saveConfig } from '../../lib/config.js';
import { setCI }         from '../../utils/context.js';
import * as filesUtils   from '../../utils/files.js';
import type { SourceConfig } from '../../types.js';

const FAKE_SOURCE: SourceConfig = {
  name: 'Agents', repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.',
};

function makeHeaders() {
  return { get: (h: string) => h === 'X-RateLimit-Remaining' ? '60' : '0' };
}

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `synap-init-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(testDir);
  vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // No token by default
  delete process.env.GITHUB_TOKEN;
  vi.mocked(execSync).mockImplementation(() => { throw new Error('no token'); });
});

afterEach(() => {
  setCI(false);
  delete process.env.GITHUB_TOKEN;
  rmSync(testDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('initCommand', () => {
  it('exits with code 2 in CI mode', async () => {
    setCI(true);
    await expect(initCommand()).rejects.toThrow('exit:2');
  });

  it('creates synap.config.json with a single source in flat format', async () => {
    vi.mocked(promptSource).mockResolvedValueOnce(FAKE_SOURCE);
    vi.mocked(p.confirm)
      .mockResolvedValueOnce(false)  // "Register another?" → No
      .mockResolvedValueOnce(false); // "Install shell completion?" → No

    await initCommand();

    const config = loadConfig(testDir);
    expect(config.repo).toBe('acme/agents');
    expect(config.sources).toBeUndefined();
  });

  it('creates synap.config.json with sources array for multiple sources', async () => {
    const secondSource: SourceConfig = {
      name: 'Prompts', repo: 'acme/prompts', branch: 'main', remotePath: '', localOutput: '.',
    };
    vi.mocked(promptSource)
      .mockResolvedValueOnce(FAKE_SOURCE)
      .mockResolvedValueOnce(secondSource);
    vi.mocked(p.confirm)
      .mockResolvedValueOnce(true)   // "Register another?" → Yes
      .mockResolvedValueOnce(false)  // "Register another?" → No
      .mockResolvedValueOnce(false); // "Install shell completion?" → No

    await initCommand();

    const config = loadConfig(testDir);
    expect(config.sources).toHaveLength(2);
    expect(config.sources![0].repo).toBe('acme/agents');
    expect(config.sources![1].repo).toBe('acme/prompts');
  });

  it('exits cleanly when overwrite confirm is cancelled via isCancel', async () => {
    saveConfig({ repo: 'acme/old', branch: 'main', remotePath: '', localOutput: '.' }, testDir);

    vi.mocked(p.isCancel).mockReturnValueOnce(true);
    vi.mocked(p.confirm).mockResolvedValueOnce(Symbol('cancel') as unknown as boolean);

    await expect(initCommand()).rejects.toThrow('exit:0');
  });

  it('stops adding sources when "Register another?" is cancelled via isCancel', async () => {
    vi.mocked(promptSource).mockResolvedValueOnce(FAKE_SOURCE);
    vi.mocked(p.isCancel).mockReturnValueOnce(true);
    vi.mocked(p.confirm)
      .mockResolvedValueOnce(Symbol('cancel') as unknown as boolean) // "Register another?" cancelled
      .mockResolvedValueOnce(false); // "Install shell completion?" → No

    await initCommand();

    const config = loadConfig(testDir);
    expect(config.repo).toBe('acme/agents');
  });

  it('exits cleanly when user declines to overwrite existing config', async () => {
    // Pre-create config so existsSync returns true
    saveConfig({ repo: 'acme/existing', branch: 'main', remotePath: '', localOutput: '.' }, testDir);

    vi.mocked(p.confirm).mockResolvedValueOnce(false); // "Overwrite?" → No

    await expect(initCommand()).rejects.toThrow('exit:0');
  });

  it('overwrites existing config when user confirms', async () => {
    saveConfig({ repo: 'acme/old', branch: 'main', remotePath: '', localOutput: '.' }, testDir);

    vi.mocked(p.confirm)
      .mockResolvedValueOnce(true)   // "Overwrite?" → Yes
      .mockResolvedValueOnce(false)  // "Register another?" → No
      .mockResolvedValueOnce(false); // "Install shell completion?" → No
    vi.mocked(promptSource).mockResolvedValueOnce(FAKE_SOURCE);

    await initCommand();

    const config = loadConfig(testDir);
    expect(config.repo).toBe('acme/agents');
  });

  it('validates token when GITHUB_TOKEN is set', async () => {
    process.env.GITHUB_TOKEN = 'valid-token';
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: (h: string) => h === 'X-RateLimit-Remaining' ? '60' : '0' },
      json: () => Promise.resolve({ login: 'alice' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.mocked(promptSource).mockResolvedValueOnce(FAKE_SOURCE);
    vi.mocked(p.confirm)
      .mockResolvedValueOnce(false)  // "Register another?" → No
      .mockResolvedValueOnce(false); // "Install shell completion?" → No

    await initCommand();

    // fetch should have been called once — for /user (validateToken)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/user');
  });

  it('continues gracefully when token validation fails', async () => {
    process.env.GITHUB_TOKEN = 'bad-token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false, status: 401, statusText: 'Unauthorized',
      headers: { get: () => '60' },
      json: () => Promise.resolve({}),
    }));

    vi.mocked(promptSource).mockResolvedValueOnce(FAKE_SOURCE);
    vi.mocked(p.confirm)
      .mockResolvedValueOnce(false)  // "Register another?" → No
      .mockResolvedValueOnce(false); // "Install shell completion?" → No

    // Should not throw
    await initCommand();
    expect(existsSync(join(testDir, 'synap.config.json'))).toBe(true);
  });

  it('shows no-token warning when GITHUB_TOKEN is absent', async () => {
    vi.mocked(promptSource).mockResolvedValueOnce(FAKE_SOURCE);
    vi.mocked(p.confirm)
      .mockResolvedValueOnce(false)  // "Register another?" → No
      .mockResolvedValueOnce(false); // "Install shell completion?" → No

    const consoleSpy = vi.spyOn(console, 'log');
    await initCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('No GitHub token');
  });

  it('shows non-writable warning when output directory cannot be written', async () => {
    vi.spyOn(filesUtils, 'isDirWritable').mockReturnValueOnce(false);
    vi.mocked(promptSource).mockResolvedValueOnce(FAKE_SOURCE);
    vi.mocked(p.confirm)
      .mockResolvedValueOnce(false)  // "Register another?" → No
      .mockResolvedValueOnce(false); // "Install shell completion?" → No

    const consoleSpy = vi.spyOn(console, 'log');
    await initCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('not writable');
  });

  it('invokes completionCommand when user accepts shell completion install', async () => {
    const { completionCommand } = await import('../../commands/completion.js');
    vi.mocked(promptSource).mockResolvedValueOnce(FAKE_SOURCE);
    vi.mocked(p.confirm)
      .mockResolvedValueOnce(false)  // "Register another?" → No
      .mockResolvedValueOnce(true);  // "Install shell completion?" → Yes

    await initCommand();

    expect(completionCommand).toHaveBeenCalledWith(undefined, { install: true });
  });

  it('skips completionCommand when user declines shell completion install', async () => {
    const { completionCommand } = await import('../../commands/completion.js');
    vi.mocked(promptSource).mockResolvedValueOnce(FAKE_SOURCE);
    vi.mocked(p.confirm)
      .mockResolvedValueOnce(false)  // "Register another?" → No
      .mockResolvedValueOnce(false); // "Install shell completion?" → No

    await initCommand();

    expect(completionCommand).not.toHaveBeenCalled();
  });

  it('skips completionCommand when confirm is cancelled', async () => {
    const { completionCommand } = await import('../../commands/completion.js');
    vi.mocked(promptSource).mockResolvedValueOnce(FAKE_SOURCE);
    vi.mocked(p.confirm)
      .mockResolvedValueOnce(false)                              // "Register another?" → No
      .mockResolvedValueOnce(Symbol('cancel') as unknown as boolean); // cancel
    vi.mocked(p.isCancel).mockReturnValueOnce(false).mockReturnValueOnce(true);

    await initCommand();

    expect(completionCommand).not.toHaveBeenCalled();
  });
});
