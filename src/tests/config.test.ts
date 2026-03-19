import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseRepoString, lockKey, resolvedSources,
  loadConfig, saveConfig, loadLock, saveLock,
  migrateToMultiSource,
  CONFIG_FILE, LOCK_FILE,
} from '../lib/config.js';
import type { SynapConfig, LockFile } from '../types.js';

// ─── Temp directory setup ─────────────────────────────────────────────────────

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `synapcli-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ─── parseRepoString ──────────────────────────────────────────────────────────

describe('parseRepoString', () => {
  it('parses owner/repo shorthand', () => {
    expect(parseRepoString('acme/agents')).toEqual({ owner: 'acme', repo: 'agents' });
  });

  it('parses full https GitHub URL', () => {
    expect(parseRepoString('https://github.com/acme/agents')).toEqual({ owner: 'acme', repo: 'agents' });
  });

  it('parses URL with .git suffix', () => {
    expect(parseRepoString('https://github.com/acme/agents.git')).toEqual({ owner: 'acme', repo: 'agents' });
  });

  it('parses SSH GitHub URL', () => {
    expect(parseRepoString('git@github.com:acme/agents')).toEqual({ owner: 'acme', repo: 'agents' });
  });

  it('throws on invalid format', () => {
    expect(() => parseRepoString('not-a-repo')).toThrow();
    expect(() => parseRepoString('')).toThrow();
  });

  it('throws on single segment', () => {
    expect(() => parseRepoString('justoneword')).toThrow();
  });
});

// ─── lockKey ─────────────────────────────────────────────────────────────────

describe('lockKey', () => {
  it('namespaces a file path under its repo', () => {
    expect(lockKey('acme/agents', 'summarizer.md')).toBe('acme/agents::summarizer.md');
  });

  it('handles nested paths', () => {
    expect(lockKey('acme/agents', 'deep/nested/file.md')).toBe('acme/agents::deep/nested/file.md');
  });

  it('handles cross-org repo names', () => {
    expect(lockKey('acme-org/ai-agents', 'file.md')).toBe('acme-org/ai-agents::file.md');
  });
});

// ─── loadConfig / saveConfig ──────────────────────────────────────────────────

describe('loadConfig', () => {
  it('throws when config file does not exist', () => {
    expect(() => loadConfig(testDir)).toThrow(`No ${CONFIG_FILE} found`);
  });

  it('throws when config file contains invalid JSON', () => {
    writeFileSync(join(testDir, CONFIG_FILE), 'not valid json', 'utf8');
    expect(() => loadConfig(testDir)).toThrow(`Failed to parse ${CONFIG_FILE}`);
  });

  it('loads a valid config file', () => {
    const config: SynapConfig = { repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.' };
    saveConfig(config, testDir);
    const loaded = loadConfig(testDir);
    expect(loaded.repo).toBe('acme/agents');
    expect(loaded.branch).toBe('main');
  });
});

describe('saveConfig', () => {
  it('writes config as formatted JSON', () => {
    const config: SynapConfig = { repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.' };
    saveConfig(config, testDir);
    expect(existsSync(join(testDir, CONFIG_FILE))).toBe(true);
    const loaded = loadConfig(testDir);
    expect(loaded).toMatchObject(config);
  });

  it('overwrites an existing config', () => {
    const config1: SynapConfig = { repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.' };
    const config2: SynapConfig = { repo: 'acme/prompts', branch: 'dev', remotePath: '', localOutput: '.' };
    saveConfig(config1, testDir);
    saveConfig(config2, testDir);
    const loaded = loadConfig(testDir);
    expect(loaded.repo).toBe('acme/prompts');
    expect(loaded.branch).toBe('dev');
  });

  it('saves multi-source config correctly', () => {
    const config: SynapConfig = {
      sources: [
        { repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.' },
        { repo: 'acme/prompts', branch: 'main', remotePath: '', localOutput: '.' },
      ],
    };
    saveConfig(config, testDir);
    const loaded = loadConfig(testDir);
    expect(loaded.sources).toHaveLength(2);
  });
});

// ─── loadLock / saveLock ──────────────────────────────────────────────────────

describe('loadLock', () => {
  it('returns empty object when lock file does not exist', () => {
    const lock = loadLock(testDir);
    expect(lock).toEqual({});
  });

  it('returns empty object when lock file contains invalid JSON', () => {
    writeFileSync(join(testDir, LOCK_FILE), 'not valid json', 'utf8');
    const lock = loadLock(testDir);
    expect(lock).toEqual({});
  });

  it('loads a valid lock file', () => {
    const lock: LockFile = {
      'acme/agents::summarizer.md': { sha: 'abc123', ref: 'main', pulledAt: '2024-01-01T00:00:00.000Z' },
    };
    saveLock(lock, testDir);
    const loaded = loadLock(testDir);
    expect(loaded['acme/agents::summarizer.md'].sha).toBe('abc123');
  });
});

describe('saveLock', () => {
  it('writes lock file to disk', () => {
    const lock: LockFile = {
      'acme/agents::summarizer.md': { sha: 'abc123', ref: 'main', pulledAt: '2024-01-01T00:00:00.000Z' },
    };
    saveLock(lock, testDir);
    expect(existsSync(join(testDir, LOCK_FILE))).toBe(true);
  });

  it('round-trips lock data correctly', () => {
    const lock: LockFile = {
      'acme/agents::a.md': { sha: 'aaa', ref: 'main', pulledAt: '2024-01-01T00:00:00.000Z' },
      'acme/agents::b.md': { sha: 'bbb', ref: 'dev',  pulledAt: '2024-01-02T00:00:00.000Z' },
    };
    saveLock(lock, testDir);
    const loaded = loadLock(testDir);
    expect(loaded['acme/agents::a.md'].sha).toBe('aaa');
    expect(loaded['acme/agents::b.md'].ref).toBe('dev');
  });
});

// ─── resolvedSources ──────────────────────────────────────────────────────────

describe('resolvedSources', () => {
  it('returns sources array when present', () => {
    const config: SynapConfig = {
      sources: [{ repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.' }],
    };
    const sources = resolvedSources(config);
    expect(sources).toHaveLength(1);
    expect(sources[0].repo).toBe('acme/agents');
  });

  it('normalises legacy single-source config', () => {
    const config: SynapConfig = { repo: 'acme/agents', branch: 'main', remotePath: 'agents', localOutput: '.' };
    const sources = resolvedSources(config);
    expect(sources).toHaveLength(1);
    expect(sources[0].repo).toBe('acme/agents');
    expect(sources[0].remotePath).toBe('agents');
  });

  it('uses default branch main when not specified', () => {
    const config: SynapConfig = { repo: 'acme/agents', remotePath: '', localOutput: '.' };
    const sources = resolvedSources(config);
    expect(sources[0].branch).toBe('main');
  });

  it('uses default remotePath empty string when not specified', () => {
    const config = { repo: 'acme/agents', branch: 'main', remotePath: undefined, localOutput: '.' } as unknown as SynapConfig;
    const sources = resolvedSources(config);
    expect(sources[0].remotePath).toBe('');
  });

  it('uses defined remotePath when specified', () => {
    const config: SynapConfig = { repo: 'acme/agents', branch: 'main', remotePath: 'agents', localOutput: '.' };
    const sources = resolvedSources(config);
    expect(sources[0].remotePath).toBe('agents');
  });

  it('uses default localOutput . when not specified', () => {
    const config = { repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: undefined } as unknown as SynapConfig;
    const sources = resolvedSources(config);
    expect(sources[0].localOutput).toBe('.');
  });

  it('uses defined localOutput when specified', () => {
    const config: SynapConfig = { repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: 'src/agents' };
    const sources = resolvedSources(config);
    expect(sources[0].localOutput).toBe('src/agents');
  });

  it('throws when neither repo nor sources are set', () => {
    expect(() => resolvedSources({} as SynapConfig)).toThrow();
  });

  it('ignores empty sources array and falls back to repo field', () => {
    const config: SynapConfig = { sources: [], repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.' };
    const sources = resolvedSources(config);
    expect(sources[0].repo).toBe('acme/agents');
  });
});

// ─── migrateToMultiSource ─────────────────────────────────────────────────────

describe('migrateToMultiSource', () => {
  it('returns config as-is if already multi-source', () => {
    const config: SynapConfig = {
      sources: [{ repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.' }],
    };
    const result = migrateToMultiSource(config);
    expect(result).toBe(config);
  });

  it('migrates single-source flat format to sources array', () => {
    const config: SynapConfig = { repo: 'acme/agents', branch: 'main', remotePath: 'agents', localOutput: '.' };
    const result = migrateToMultiSource(config);
    expect(result.sources).toHaveLength(1);
    expect(result.sources![0].repo).toBe('acme/agents');
    expect(result.sources![0].branch).toBe('main');
    expect(result.sources![0].remotePath).toBe('agents');
    expect(result.repo).toBeUndefined();
  });

  it('preserves postpull hook during migration', () => {
    const config: SynapConfig = { repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.', postpull: 'prettier --write .' };
    const result = migrateToMultiSource(config);
    expect(result.postpull).toBe('prettier --write .');
  });

  it('uses default branch main when not specified during migration', () => {
    const config = { repo: 'acme/agents', branch: undefined, remotePath: '', localOutput: '.' } as unknown as SynapConfig;
    const result = migrateToMultiSource(config);
    expect(result.sources![0].branch).toBe('main');
  });

  it('uses defined branch when specified during migration', () => {
    const config: SynapConfig = { repo: 'acme/agents', branch: 'dev', remotePath: '', localOutput: '.' };
    const result = migrateToMultiSource(config);
    expect(result.sources![0].branch).toBe('dev');
  });

  it('uses default remotePath empty string when not specified during migration', () => {
    const config = { repo: 'acme/agents', branch: 'main', remotePath: undefined, localOutput: '.' } as unknown as SynapConfig;
    const result = migrateToMultiSource(config);
    expect(result.sources![0].remotePath).toBe('');
  });

  it('uses defined remotePath when specified during migration', () => {
    const config: SynapConfig = { repo: 'acme/agents', branch: 'main', remotePath: 'agents', localOutput: '.' };
    const result = migrateToMultiSource(config);
    expect(result.sources![0].remotePath).toBe('agents');
  });

  it('uses default localOutput . when not specified during migration', () => {
    const config = { repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: undefined } as unknown as SynapConfig;
    const result = migrateToMultiSource(config);
    expect(result.sources![0].localOutput).toBe('.');
  });

  it('uses defined localOutput when specified during migration', () => {
    const config: SynapConfig = { repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: 'src/agents' };
    const result = migrateToMultiSource(config);
    expect(result.sources![0].localOutput).toBe('src/agents');
  });

  it('returns config unchanged if no repo or sources', () => {
    const config: SynapConfig = {};
    const result = migrateToMultiSource(config);
    expect(result).toEqual({});
  });
});
