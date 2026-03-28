import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('@clack/prompts', () => ({
  intro:    vi.fn(),
  outro:    vi.fn(),
  confirm:  vi.fn().mockResolvedValue(false), // "Register another?" → No by default
  isCancel: vi.fn(() => false),
  cancel:   vi.fn(),
}));

vi.mock('../../lib/sourcePrompt.js', () => ({
  promptSource: vi.fn(),
}));

import * as p                                   from '@clack/prompts';
import { registerCommand }                       from '../../commands/register.js';
import { promptSource }                          from '../../lib/sourcePrompt.js';
import { saveConfig, loadConfig, CONFIG_FILE }   from '../../lib/config.js';
import { setCI }                                 from '../../utils/context.js';
import type { SynapConfig, SourceConfig }        from '../../types.js';

const NEW_SOURCE: SourceConfig = {
  name: 'Prompts', repo: 'acme/prompts', branch: 'main', remotePath: '', localOutput: '.',
};

const SECOND_SOURCE: SourceConfig = {
  name: 'Tools', repo: 'acme/tools', branch: 'main', remotePath: '', localOutput: '.',
};

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `synap-register-${Date.now()}`);
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

describe('registerCommand', () => {

  it('migrates single-source config to multi-source and adds new source', async () => {
    saveConfig({ repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.' }, testDir);
    vi.mocked(promptSource).mockResolvedValueOnce(NEW_SOURCE);
    vi.mocked(p.confirm).mockResolvedValue(false);

    await registerCommand();

    const config = loadConfig(testDir);
    expect(config.sources).toHaveLength(2);
    expect(config.sources![0].repo).toBe('acme/agents');
    expect(config.sources![1].repo).toBe('acme/prompts');
    expect(config.repo).toBeUndefined();
  });

  it('appends to existing multi-source config', async () => {
    saveConfig({
      sources: [{ name: 'Agents', repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.' }],
    }, testDir);
    vi.mocked(promptSource).mockResolvedValueOnce(NEW_SOURCE);
    vi.mocked(p.confirm).mockResolvedValue(false);

    await registerCommand();

    const config = loadConfig(testDir);
    expect(config.sources).toHaveLength(2);
    expect(config.sources![1].repo).toBe('acme/prompts');
  });

  it('adds multiple sources in a single session', async () => {
    saveConfig({ repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.' }, testDir);
    vi.mocked(promptSource)
      .mockResolvedValueOnce(NEW_SOURCE)
      .mockResolvedValueOnce(SECOND_SOURCE);
    vi.mocked(p.confirm)
      .mockResolvedValueOnce(true)   // "Register another?" after first → Yes
      .mockResolvedValueOnce(false); // "Register another?" after second → No

    await registerCommand();

    const config = loadConfig(testDir);
    expect(config.sources).toHaveLength(3);
    expect(config.sources!.map(s => s.repo)).toContain('acme/prompts');
    expect(config.sources!.map(s => s.repo)).toContain('acme/tools');
  });

  it('skips duplicate repo and does not save', async () => {
    saveConfig({ repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.' }, testDir);
    // Attempt to register a repo that already exists
    vi.mocked(promptSource).mockResolvedValueOnce({
      name: 'Agents Again', repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.',
    });
    vi.mocked(p.confirm).mockResolvedValue(false);

    await expect(registerCommand()).rejects.toThrow('exit:0');
  });

  it('exits cleanly when no new sources are added (duplicate skipped and no more)', async () => {
    saveConfig({ repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.' }, testDir);
    vi.mocked(promptSource).mockResolvedValueOnce({
      name: 'Dup', repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.',
    });
    vi.mocked(p.confirm).mockResolvedValue(false);

    await expect(registerCommand()).rejects.toThrow('exit:0');

    // Config not saved when nothing was added — still flat single-source format
    const config = loadConfig(testDir);
    expect(config.repo).toBe('acme/agents');
  });

  it('exits with code 2 when config file is missing', async () => {
    await expect(registerCommand()).rejects.toThrow('exit:2');
  });

  it('exits with code 2 in CI mode', async () => {
    setCI(true);
    saveConfig({ repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.' }, testDir);
    await expect(registerCommand()).rejects.toThrow('exit:2');
  });

  it('allows same repo with different remotePath', async () => {
  saveConfig({ repo: 'acme/agents', branch: 'main', remotePath: 'agents', localOutput: '.' }, testDir);
  vi.mocked(promptSource).mockResolvedValueOnce({
    name: 'Prompts', repo: 'acme/agents', branch: 'main', remotePath: 'prompts', localOutput: '.',
  });
  vi.mocked(p.confirm).mockResolvedValue(false);

  await registerCommand();

  const config = loadConfig(testDir);
  expect(config.sources).toHaveLength(2);
  expect(config.sources!.map(s => s.remotePath)).toContain('agents');
  expect(config.sources!.map(s => s.remotePath)).toContain('prompts');
});
});
