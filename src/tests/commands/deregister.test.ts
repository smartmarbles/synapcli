import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('@clack/prompts', () => ({
  intro:       vi.fn(),
  outro:       vi.fn(),
  multiselect: vi.fn().mockResolvedValue([]),
  confirm:     vi.fn().mockResolvedValue(true),
  isCancel:    vi.fn(() => false),
  cancel:      vi.fn(),
}));

import * as p                                           from '@clack/prompts';
import { deregisterCommand }                             from '../../commands/deregister.js';
import { saveConfig, saveLock, loadConfig, loadLock }    from '../../lib/config.js';
import { setCI }                                         from '../../utils/context.js';
import type { SynapConfig }                              from '../../types.js';

const BRANCH     = 'main';
const LOCK_ENTRY = { sha: 'sha-v1', ref: BRANCH, pulledAt: new Date().toISOString() };

let testDir: string;

const MULTI_CONFIG: SynapConfig = {
  sources: [
    { name: 'Agents',  repo: 'acme/agents',  branch: BRANCH, remotePath: '', localOutput: '.' },
    { name: 'Prompts', repo: 'acme/prompts', branch: BRANCH, remotePath: '', localOutput: '.' },
  ],
};

beforeEach(() => {
  testDir = join(tmpdir(), `synap-deregister-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(testDir);
  vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setCI(false);
  rmSync(testDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('deregisterCommand', () => {

  it('removes a source and cleans its lock entries', async () => {
    saveConfig(MULTI_CONFIG, testDir);
    saveLock({
      ['acme/agents::summarizer.md']:  { ...LOCK_ENTRY },
      ['acme/prompts::system.md']:     { ...LOCK_ENTRY },
      ['acme/prompts::assistant.md']:  { ...LOCK_ENTRY },
    }, testDir);

    vi.mocked(p.multiselect).mockResolvedValueOnce(['acme/prompts']);
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await deregisterCommand();

    const config = loadConfig(testDir);
    const lock   = loadLock(testDir);

    // One source remains → config downgraded to flat format, no sources array
    expect(config.repo).toBe('acme/agents');
    expect(config.sources).toBeUndefined();
    expect(lock['acme/prompts::system.md']).toBeUndefined();
    expect(lock['acme/prompts::assistant.md']).toBeUndefined();
    expect(lock['acme/agents::summarizer.md']).toBeDefined();
  });

  it('downgrades to flat single-source format when one source remains', async () => {
    saveConfig(MULTI_CONFIG, testDir);
    vi.mocked(p.multiselect).mockResolvedValueOnce(['acme/prompts']);
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await deregisterCommand();

    const config = loadConfig(testDir);
    expect(config.repo).toBe('acme/agents');
    expect(config.sources).toBeUndefined();
  });

  it('preserves postpull hook when downgrading to flat format', async () => {
    saveConfig({ ...MULTI_CONFIG, postpull: 'echo done' }, testDir);
    vi.mocked(p.multiselect).mockResolvedValueOnce(['acme/prompts']);
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await deregisterCommand();

    const config = loadConfig(testDir);
    expect(config.postpull).toBe('echo done');
  });

  it('saves empty sources array when all sources are removed', async () => {
    saveConfig(MULTI_CONFIG, testDir);
    vi.mocked(p.multiselect).mockResolvedValueOnce(['acme/agents', 'acme/prompts']);
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await deregisterCommand();

    const config = loadConfig(testDir);
    expect(config.sources).toHaveLength(0);
  });

  it('cancellation leaves config unchanged', async () => {
    saveConfig(MULTI_CONFIG, testDir);
    vi.mocked(p.multiselect).mockResolvedValueOnce(['acme/prompts']);
    vi.mocked(p.confirm).mockResolvedValueOnce(false); // confirm removal → No

    await expect(deregisterCommand()).rejects.toThrow('exit:0');

    const config = loadConfig(testDir);
    expect(config.sources).toHaveLength(2);
  });

  it('migrates single-source flat config to multi-source before deregistering', async () => {
    saveConfig({ repo: 'acme/agents', branch: BRANCH, remotePath: '', localOutput: '.' }, testDir);

    // After migration there's only 1 source — exit cleanly with no sources to deregister
    // (multiselect would be shown, but we select the only source)
    vi.mocked(p.multiselect).mockResolvedValueOnce(['acme/agents']);
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await deregisterCommand();

    const config = loadConfig(testDir);
    expect(config.sources).toHaveLength(0);
  });

  it('exits with code 2 when config file is missing', async () => {
    await expect(deregisterCommand()).rejects.toThrow('exit:2');
  });

  it('exits with code 2 in CI mode', async () => {
    setCI(true);
    saveConfig(MULTI_CONFIG, testDir);
    await expect(deregisterCommand()).rejects.toThrow('exit:2');
  });

  it('exits cleanly when multiselect is cancelled', async () => {
    saveConfig(MULTI_CONFIG, testDir);
    vi.mocked(p.isCancel).mockReturnValueOnce(true);
    vi.mocked(p.multiselect).mockResolvedValueOnce(Symbol('cancel') as unknown as string[]);

    await expect(deregisterCommand()).rejects.toThrow('exit:0');
    expect(loadConfig(testDir).sources).toHaveLength(2);
  });

  it('exits cleanly when confirm prompt is cancelled', async () => {
    saveConfig(MULTI_CONFIG, testDir);
    vi.mocked(p.multiselect).mockResolvedValueOnce(['acme/prompts']);
    vi.mocked(p.isCancel).mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.mocked(p.confirm).mockResolvedValueOnce(Symbol('cancel') as unknown as boolean);

    await expect(deregisterCommand()).rejects.toThrow('exit:0');
    expect(loadConfig(testDir).sources).toHaveLength(2);
  });

  it('warns when no sources are remaining after removal', async () => {
    saveConfig(MULTI_CONFIG, testDir);
    vi.mocked(p.multiselect).mockResolvedValueOnce(['acme/agents', 'acme/prompts']);
    vi.mocked(p.confirm).mockResolvedValueOnce(true);
    const consoleSpy = vi.spyOn(console, 'log');

    await deregisterCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('No sources remaining');
  });

  it('exits cleanly when config has no sources', async () => {
    saveConfig({ sources: [] }, testDir);
    await expect(deregisterCommand()).rejects.toThrow('exit:0');
  });

  it('keeps multi-source format when two or more sources remain', async () => {
    saveConfig({
      sources: [
        { name: 'Agents',  repo: 'acme/agents',  branch: BRANCH, remotePath: '', localOutput: '.' },
        { name: 'Prompts', repo: 'acme/prompts', branch: BRANCH, remotePath: '', localOutput: '.' },
        { name: 'Tools',   repo: 'acme/tools',   branch: BRANCH, remotePath: '', localOutput: '.' },
      ],
    }, testDir);
    vi.mocked(p.multiselect).mockResolvedValueOnce(['acme/tools']);
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await deregisterCommand();

    const config = loadConfig(testDir);
    expect(config.sources).toHaveLength(2);
  });
});
