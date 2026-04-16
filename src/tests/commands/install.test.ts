import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
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
  intro:    vi.fn(),
  outro:    vi.fn(),
  confirm:  vi.fn().mockResolvedValue(true),
  select:   vi.fn(),
  text:     vi.fn(),
  isCancel: vi.fn(() => false),
  cancel:   vi.fn(),
}));

vi.mock('../../utils/progress.js', () => ({
  SynapProgress: class { tick = vi.fn(); stop = vi.fn(); },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import * as p from '@clack/prompts';
import { installCommand, collectionLockKey } from '../../commands/install.js';
import { saveConfig, loadConfig, loadLock, saveLock, LOCK_FILE } from '../../lib/config.js';
import { setCI } from '../../utils/context.js';
import type { SynapConfig, CollectionAsset } from '../../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAsset(overrides: Partial<CollectionAsset> = {}): CollectionAsset {
  return {
    repo: 'acme/agents',
    branch: 'main',
    path: 'skills/react/SKILL.md',
    defaultOutput: '.github/skills',
    ...overrides,
  };
}

function makeCollection(assets: CollectionAsset[] = [makeAsset()]) {
  return {
    name: 'React Kit',
    description: 'Curated React assets',
    assets,
  };
}

function writeCollection(dir: string, collection: ReturnType<typeof makeCollection>, filename = 'react.collection.json'): string {
  const filePath = join(dir, filename);
  writeFileSync(filePath, JSON.stringify(collection));
  return filePath;
}

function makeHeaders() {
  return { get: (h: string) => h === 'X-RateLimit-Remaining' ? '60' : '0' };
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

// ── Setup ─────────────────────────────────────────────────────────────────────

let testDir: string;

const BASE_CONFIG: SynapConfig = {
  sources: [{ name: 'Agents', repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.' }],
};

beforeEach(() => {
  testDir = join(tmpdir(), `synap-install-${Date.now()}`);
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
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('collectionLockKey', () => {
  it('builds a _collection:: namespaced key', () => {
    expect(collectionLockKey('React Kit')).toBe('_collection::React Kit');
  });
});

describe('installCommand', () => {

  it('installs files from a local collection with --yes', async () => {
    saveConfig({ ...BASE_CONFIG, preset: 'copilot' }, testDir);
    const collection = makeCollection();
    const collectionPath = writeCollection(testDir, collection);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeFileResponse('skills/react/SKILL.md', 'sha-react', '# React SKILL')));

    await installCommand(collectionPath, { yes: true });

    // File written to disk
    const written = readFileSync(join(testDir, '.github', 'skills', 'SKILL.md'), 'utf8');
    expect(written).toBe('# React SKILL');

    // Lock entry for individual file
    const lock = loadLock(testDir);
    expect(lock['acme/agents::skills/react/SKILL.md']).toMatchObject({
      sha: 'sha-react',
      ref: 'main',
      collection: 'React Kit',
    });

    // Lock entry for collection definition
    const defKey = collectionLockKey('React Kit');
    expect(lock[defKey]).toMatchObject({
      origin: collectionPath,
      pathOverrides: {},
    });
  });

  it('applies claude preset remapping', async () => {
    saveConfig({ ...BASE_CONFIG, preset: 'claude' }, testDir);
    const collection = makeCollection();
    const collectionPath = writeCollection(testDir, collection);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeFileResponse('skills/react/SKILL.md', 'sha-react', '# React')));

    await installCommand(collectionPath, { yes: true });

    // Should write to .claude/skills instead of .github/skills
    const written = readFileSync(join(testDir, '.claude', 'skills', 'SKILL.md'), 'utf8');
    expect(written).toBe('# React');

    // pathOverrides should record the mapping
    const lock = loadLock(testDir);
    const defKey = collectionLockKey('React Kit');
    expect(lock[defKey].pathOverrides).toEqual({ '.github/skills': '.claude/skills' });
  });

  it('prompts for preset when not set and saves to config', async () => {
    saveConfig(BASE_CONFIG, testDir);
    const collection = makeCollection();
    const collectionPath = writeCollection(testDir, collection);

    vi.mocked(p.select).mockResolvedValueOnce('claude');
    vi.mocked(p.text).mockResolvedValueOnce('.claude/skills');
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeFileResponse('skills/react/SKILL.md', 'sha-react', '# React')));

    await installCommand(collectionPath, {});

    // Preset saved to config
    const config = loadConfig(testDir);
    expect(config.preset).toBe('claude');
  });

  it('defaults to copilot preset when --yes and no preset in config', async () => {
    saveConfig(BASE_CONFIG, testDir);
    const collection = makeCollection();
    const collectionPath = writeCollection(testDir, collection);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeFileResponse('skills/react/SKILL.md', 'sha-react', '# React')));

    await installCommand(collectionPath, { yes: true });

    const config = loadConfig(testDir);
    expect(config.preset).toBe('copilot');
  });

  it('defaults to copilot preset in CI mode', async () => {
    setCI(true);
    saveConfig(BASE_CONFIG, testDir);
    const collection = makeCollection();
    const collectionPath = writeCollection(testDir, collection);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeFileResponse('skills/react/SKILL.md', 'sha-react', '# React')));

    await installCommand(collectionPath, {});

    const config = loadConfig(testDir);
    expect(config.preset).toBe('copilot');
  });

  it('uses --preset flag over config preset', async () => {
    saveConfig({ ...BASE_CONFIG, preset: 'copilot' }, testDir);
    const collection = makeCollection();
    const collectionPath = writeCollection(testDir, collection);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeFileResponse('skills/react/SKILL.md', 'sha-react', '# React')));

    await installCommand(collectionPath, { yes: true, preset: 'gemini' });

    // Should use gemini, not copilot
    const written = readFileSync(join(testDir, '.gemini', 'skills', 'SKILL.md'), 'utf8');
    expect(written).toBe('# React');
  });

  it('errors on invalid preset name', async () => {
    saveConfig(BASE_CONFIG, testDir);
    const collectionPath = writeCollection(testDir, makeCollection());

    await expect(
      installCommand(collectionPath, { preset: 'bogus' })
    ).rejects.toThrow('exit:2');
  });

  it('does not re-save preset to config if already set', async () => {
    saveConfig({ ...BASE_CONFIG, preset: 'claude' }, testDir);
    const collection = makeCollection();
    const collectionPath = writeCollection(testDir, collection);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeFileResponse('skills/react/SKILL.md', 'sha-react', '# React')));

    await installCommand(collectionPath, { yes: true });

    // Config should still just have 'claude'
    const config = loadConfig(testDir);
    expect(config.preset).toBe('claude');
  });

  // ── Dry run ─────────────────────────────────────────────────────────────

  it('dry run shows files without writing', async () => {
    saveConfig({ ...BASE_CONFIG, preset: 'copilot' }, testDir);
    const collection = makeCollection();
    const collectionPath = writeCollection(testDir, collection);

    await installCommand(collectionPath, { dryRun: true });

    // No lock changes
    const lock = loadLock(testDir);
    expect(Object.keys(lock)).toHaveLength(0);
  });

  // ── Multiple assets ─────────────────────────────────────────────────────

  it('installs multiple assets across different outputs', async () => {
    saveConfig({ ...BASE_CONFIG, preset: 'copilot' }, testDir);
    const assets = [
      makeAsset({ path: 'skills/react/SKILL.md', defaultOutput: '.github/skills' }),
      makeAsset({ path: 'instructions/ts.instructions.md', defaultOutput: '.github/instructions' }),
      makeAsset({ repo: 'acme/tools', path: 'scripts/lint.py', defaultOutput: 'scripts' }),
    ];
    const collection = makeCollection(assets);
    const collectionPath = writeCollection(testDir, collection);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeFileResponse('skills/react/SKILL.md', 'sha-skill', '# Skill'))
      .mockResolvedValueOnce(makeFileResponse('instructions/ts.instructions.md', 'sha-ts', '# TS'))
      .mockResolvedValueOnce(makeFileResponse('scripts/lint.py', 'sha-lint', '# lint')));

    await installCommand(collectionPath, { yes: true });

    expect(readFileSync(join(testDir, '.github', 'skills', 'SKILL.md'), 'utf8')).toBe('# Skill');
    expect(readFileSync(join(testDir, '.github', 'instructions', 'ts.instructions.md'), 'utf8')).toBe('# TS');
    expect(readFileSync(join(testDir, 'scripts', 'lint.py'), 'utf8')).toBe('# lint');

    const lock = loadLock(testDir);
    expect(lock['acme/agents::skills/react/SKILL.md']).toBeDefined();
    expect(lock['acme/agents::instructions/ts.instructions.md']).toBeDefined();
    expect(lock['acme/tools::scripts/lint.py']).toBeDefined();
  });

  // ── Interactive output confirmation ──────────────────────────────────────

  it('allows overriding output directory interactively', async () => {
    saveConfig({ ...BASE_CONFIG, preset: 'copilot' }, testDir);
    const collection = makeCollection();
    const collectionPath = writeCollection(testDir, collection);

    // User overrides default output dir
    vi.mocked(p.text).mockResolvedValueOnce('custom/dir');
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeFileResponse('skills/react/SKILL.md', 'sha-react', '# React')));

    await installCommand(collectionPath, {});

    const written = readFileSync(join(testDir, 'custom', 'dir', 'SKILL.md'), 'utf8');
    expect(written).toBe('# React');

    // pathOverrides should record the custom mapping
    const lock = loadLock(testDir);
    const defKey = collectionLockKey('React Kit');
    expect(lock[defKey].pathOverrides).toEqual({ '.github/skills': 'custom/dir' });
  });

  it('uses default when text prompt returns empty string', async () => {
    saveConfig({ ...BASE_CONFIG, preset: 'copilot' }, testDir);
    const collection = makeCollection();
    const collectionPath = writeCollection(testDir, collection);

    vi.mocked(p.text).mockResolvedValueOnce('');
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeFileResponse('skills/react/SKILL.md', 'sha-react', '# React')));

    await installCommand(collectionPath, {});

    // Should fall back to the preset-resolved default
    const written = readFileSync(join(testDir, '.github', 'skills', 'SKILL.md'), 'utf8');
    expect(written).toBe('# React');
  });

  // ── Error cases ─────────────────────────────────────────────────────────

  it('exits with code 2 when config is missing', async () => {
    await expect(
      installCommand('./test.collection.json', {})
    ).rejects.toThrow('exit:2');
  });

  it('exits with code 2 when collection file is not found', async () => {
    saveConfig(BASE_CONFIG, testDir);

    await expect(
      installCommand('./nonexistent.collection.json', {})
    ).rejects.toThrow('exit:2');
  });

  it('exits with code 2 when collection is invalid JSON', async () => {
    saveConfig(BASE_CONFIG, testDir);
    const filePath = join(testDir, 'bad.json');
    writeFileSync(filePath, 'not json');

    await expect(
      installCommand(filePath, {})
    ).rejects.toThrow('exit:2');
  });

  it('reports failed downloads and exits with code 1', async () => {
    saveConfig({ ...BASE_CONFIG, preset: 'copilot' }, testDir);
    const collection = makeCollection();
    const collectionPath = writeCollection(testDir, collection);

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeErrorResponse(404, 'Not Found')));

    await expect(
      installCommand(collectionPath, { yes: true })
    ).rejects.toThrow('exit:1');
  });

  it('exits with code 2 for invalid source format', async () => {
    saveConfig(BASE_CONFIG, testDir);

    await expect(
      installCommand('https://example.com/bad.json', {})
    ).rejects.toThrow('exit:2');
  });

  // ── Remote collection via GitHub ────────────────────────────────────────

  it('installs from a GitHub shorthand source', async () => {
    saveConfig({ ...BASE_CONFIG, preset: 'copilot' }, testDir);

    const collectionContent = JSON.stringify(makeCollection());

    // First fetch: collection file itself via GitHub API
    // Second fetch: the asset file
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeFileResponse('react.collection.json', 'sha-coll',  collectionContent))
      .mockResolvedValueOnce(makeFileResponse('skills/react/SKILL.md', 'sha-react', '# React')));

    await installCommand('org/repo/react.collection.json', { yes: true });

    const lock = loadLock(testDir);
    expect(lock['acme/agents::skills/react/SKILL.md']).toBeDefined();
    expect(lock[collectionLockKey('React Kit')].origin).toBe(
      'https://raw.githubusercontent.com/org/repo/main/react.collection.json'
    );
  });
});
