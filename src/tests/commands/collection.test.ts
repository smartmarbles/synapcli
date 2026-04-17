import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@clack/prompts', () => ({
  intro:       vi.fn(),
  outro:       vi.fn(),
  multiselect: vi.fn(),
  text:        vi.fn(),
  isCancel:    vi.fn(() => false),
  cancel:      vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import * as p from '@clack/prompts';
import { collectionCreateCommand, buildAssetList } from '../../commands/collection.js';
import { saveConfig, saveLock } from '../../lib/config.js';
import { setCI } from '../../utils/context.js';
import type { SynapConfig, LockFile, LockEntry } from '../../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let testDir: string;

const BASE_CONFIG: SynapConfig = {
  sources: [
    { name: 'Agents', repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.github/skills' },
    { name: 'Tools',  repo: 'acme/tools',  branch: 'main', remotePath: '', localOutput: 'scripts' },
  ],
};

function makeLockEntry(overrides: Partial<LockEntry> = {}): LockEntry {
  return { sha: 'abc123', ref: 'main', pulledAt: '2026-04-15T00:00:00.000Z', ...overrides };
}

const BASE_LOCK: LockFile = {
  'acme/agents::skills/react/SKILL.md':   makeLockEntry(),
  'acme/agents::instructions/ts.md':      makeLockEntry(),
  'acme/tools::scripts/lint.py':          makeLockEntry({ ref: 'develop' }),
};

beforeEach(() => {
  testDir = join(tmpdir(), `synap-collection-cmd-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(testDir);
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  }) as never);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setCI(false);
  rmSync(testDir, { recursive: true, force: true });
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// ─── buildAssetList ───────────────────────────────────────────────────────────

describe('buildAssetList', () => {
  it('builds assets from lock entries matched to config sources', () => {
    const items = buildAssetList(BASE_LOCK, BASE_CONFIG.sources!);
    expect(items).toHaveLength(3);

    const react = items.find((i) => i.key === 'acme/agents::skills/react/SKILL.md');
    expect(react!.asset).toEqual({
      repo: 'acme/agents', branch: 'main', path: 'skills/react/SKILL.md', defaultOutput: '.github/skills',
    });

    const lint = items.find((i) => i.key === 'acme/tools::scripts/lint.py');
    expect(lint!.asset).toEqual({
      repo: 'acme/tools', branch: 'develop', path: 'scripts/lint.py', defaultOutput: 'scripts',
    });
  });

  it('falls back to "." when repo is not in sources', () => {
    const lock: LockFile = {
      'unknown/repo::file.md': makeLockEntry(),
    };
    const items = buildAssetList(lock, []);
    expect(items).toHaveLength(1);
    expect(items[0].asset.defaultOutput).toBe('.');
  });

  it('skips _collection:: entries', () => {
    const lock: LockFile = {
      ...BASE_LOCK,
      '_collection::React Kit': makeLockEntry({ origin: 'test', pathOverrides: {} }),
    };
    const items = buildAssetList(lock, BASE_CONFIG.sources!);
    expect(items).toHaveLength(3);
    expect(items.every((i) => !i.key.startsWith('_collection::'))).toBe(true);
  });

  it('skips __failed__ entries', () => {
    const lock = {
      ...BASE_LOCK,
      'acme/agents::__failed__': { sha: '', ref: '', pulledAt: '' } as LockEntry,
    };
    const items = buildAssetList(lock, BASE_CONFIG.sources!);
    expect(items).toHaveLength(3);
  });

  it('skips entries without :: separator', () => {
    const lock = {
      ...BASE_LOCK,
      'malformed-key': makeLockEntry(),
    };
    const items = buildAssetList(lock as LockFile, BASE_CONFIG.sources!);
    expect(items).toHaveLength(3);
  });

  it('returns empty list when lock is empty', () => {
    const items = buildAssetList({}, BASE_CONFIG.sources!);
    expect(items).toHaveLength(0);
  });

  it('uses first source localOutput when repo appears multiple times', () => {
    const lock: LockFile = {
      'acme/agents::readme.md': makeLockEntry(),
    };
    const sources = [
      { name: 'A', repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: 'first' },
      { name: 'B', repo: 'acme/agents', branch: 'main', remotePath: 'docs', localOutput: 'second' },
    ];
    const items = buildAssetList(lock, sources);
    expect(items[0].asset.defaultOutput).toBe('first');
  });
});

// ─── collectionCreateCommand ──────────────────────────────────────────────────

describe('collectionCreateCommand', () => {

  // ── --json mode ─────────────────────────────────────────────────────────

  it('writes all tracked files to stdout as JSON with --json', async () => {
    saveConfig(BASE_CONFIG, testDir);
    saveLock(BASE_LOCK, testDir);

    const logSpy = vi.mocked(console.log);
    await collectionCreateCommand('react-kit', { json: true });

    // Find the JSON output call (the one that isn't from our mock)
    const jsonOutput = logSpy.mock.calls.find((call) => {
      try { JSON.parse(call[0] as string); return true; } catch { return false; }
    });
    expect(jsonOutput).toBeDefined();

    const parsed = JSON.parse(jsonOutput![0] as string);
    expect(parsed.name).toBe('react-kit');
    expect(parsed.assets).toHaveLength(3);
    expect(parsed.assets[0]).toHaveProperty('repo');
    expect(parsed.assets[0]).toHaveProperty('branch');
    expect(parsed.assets[0]).toHaveProperty('path');
    expect(parsed.assets[0]).toHaveProperty('defaultOutput');
  });

  it('--json works in CI mode', async () => {
    setCI(true);
    saveConfig(BASE_CONFIG, testDir);
    saveLock(BASE_LOCK, testDir);

    await collectionCreateCommand('react-kit', { json: true });
    // Shouldn't throw — JSON mode bypasses interactive prompts
  });

  // ── Interactive mode ────────────────────────────────────────────────────

  it('selects all files when "Select all" sentinel is triggered', async () => {
    saveConfig(BASE_CONFIG, testDir);
    saveLock(BASE_LOCK, testDir);

    vi.mocked(p.multiselect).mockImplementationOnce(async (opts) => {
      const sentinel = (opts as { options: { value: unknown }[] }).options[0].value;
      return [sentinel] as unknown as string[];
    });
    vi.mocked(p.text)
      .mockResolvedValueOnce('All Kit')
      .mockResolvedValueOnce('Everything');

    await collectionCreateCommand('all-kit');

    const filePath = join(testDir, 'all-kit.collection.json');
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(parsed.assets).toHaveLength(3);
  });

  it('creates a collection file interactively', async () => {
    saveConfig(BASE_CONFIG, testDir);
    saveLock(BASE_LOCK, testDir);

    vi.mocked(p.multiselect).mockResolvedValueOnce([
      'acme/agents::skills/react/SKILL.md',
      'acme/tools::scripts/lint.py',
    ]);
    vi.mocked(p.text)
      .mockResolvedValueOnce('React Kit')      // display name
      .mockResolvedValueOnce('Curated React');  // description

    await collectionCreateCommand('react-kit');

    const filePath = join(testDir, 'react-kit.collection.json');
    expect(existsSync(filePath)).toBe(true);

    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(parsed.name).toBe('React Kit');
    expect(parsed.description).toBe('Curated React');
    expect(parsed.assets).toHaveLength(2);
    expect(parsed.assets[0].repo).toBe('acme/agents');
    expect(parsed.assets[1].repo).toBe('acme/tools');
  });

  it('uses CLI name as default when text prompt returns empty', async () => {
    saveConfig(BASE_CONFIG, testDir);
    saveLock(BASE_LOCK, testDir);

    vi.mocked(p.multiselect).mockResolvedValueOnce([
      'acme/agents::skills/react/SKILL.md',
    ]);
    vi.mocked(p.text)
      .mockResolvedValueOnce('')   // empty → fall back to name arg
      .mockResolvedValueOnce('');  // no description

    await collectionCreateCommand('react-kit');

    const parsed = JSON.parse(readFileSync(join(testDir, 'react-kit.collection.json'), 'utf8'));
    expect(parsed.name).toBe('react-kit');
    expect(parsed.description).toBeUndefined();
  });

  // ── Error cases ─────────────────────────────────────────────────────────

  it('errors in CI mode without --json', async () => {
    setCI(true);
    saveConfig(BASE_CONFIG, testDir);
    saveLock(BASE_LOCK, testDir);

    await expect(
      collectionCreateCommand('react-kit', {})
    ).rejects.toThrow('exit:2');
  });

  it('errors when config is missing', async () => {
    await expect(
      collectionCreateCommand('react-kit', {})
    ).rejects.toThrow('exit:2');
  });

  it('errors when lockfile has no tracked files', async () => {
    saveConfig(BASE_CONFIG, testDir);
    saveLock({}, testDir);

    await expect(
      collectionCreateCommand('react-kit', {})
    ).rejects.toThrow('exit:2');
  });

  it('errors when lockfile has only internal entries', async () => {
    saveConfig(BASE_CONFIG, testDir);
    saveLock({
      '_collection::Old Kit': makeLockEntry({ origin: 'x', pathOverrides: {} }),
    }, testDir);

    await expect(
      collectionCreateCommand('react-kit', {})
    ).rejects.toThrow('exit:2');
  });
});
