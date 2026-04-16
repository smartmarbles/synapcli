import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  parseCollectionOrigin,
  loadCollection,
  sourceKey,
  checkDuplicates,
  backupConfig,
  loadAssetCollection,
  groupByOutput,
  assetKey,
} from '../lib/collection.js';
import { saveConfig, CONFIG_FILE } from '../lib/config.js';
import type { SourceConfig, CollectionAsset } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `synap-collection-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(testDir);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeSource(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    name: 'Agents', repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.',
    ...overrides,
  };
}

// ─── parseCollectionOrigin ────────────────────────────────────────────────────

describe('parseCollectionOrigin', () => {
  it('parses a raw GitHub URL', () => {
    const result = parseCollectionOrigin(
      'https://raw.githubusercontent.com/acme/collections/main/react.collection.json'
    );
    expect(result).toEqual({
      type: 'url',
      url: 'https://raw.githubusercontent.com/acme/collections/main/react.collection.json',
      owner: 'acme',
      repo: 'collections',
      path: 'react.collection.json',
      ref: 'main',
    });
  });

  it('parses a raw GitHub URL with nested path', () => {
    const result = parseCollectionOrigin(
      'https://raw.githubusercontent.com/org/repo/develop/src/collections/react.collection.json'
    );
    expect(result).toEqual({
      type: 'url',
      url: 'https://raw.githubusercontent.com/org/repo/develop/src/collections/react.collection.json',
      owner: 'org',
      repo: 'repo',
      path: 'src/collections/react.collection.json',
      ref: 'develop',
    });
  });

  it('throws on unsupported HTTPS URL', () => {
    expect(() => parseCollectionOrigin('https://example.com/file.json')).toThrow('Unsupported URL format');
  });

  it('parses GitHub shorthand (org/repo/file)', () => {
    const result = parseCollectionOrigin('acme/collections/react.collection.json');
    expect(result).toEqual({
      type: 'url',
      url: 'https://raw.githubusercontent.com/acme/collections/main/react.collection.json',
      owner: 'acme',
      repo: 'collections',
      path: 'react.collection.json',
      ref: 'main',
    });
  });

  it('parses GitHub shorthand with nested path', () => {
    const result = parseCollectionOrigin('acme/repo/src/collections/react.collection.json');
    expect(result).toEqual({
      type: 'url',
      url: 'https://raw.githubusercontent.com/acme/repo/main/src/collections/react.collection.json',
      owner: 'acme',
      repo: 'repo',
      path: 'src/collections/react.collection.json',
      ref: 'main',
    });
  });

  it('uses custom ref for GitHub shorthand', () => {
    const result = parseCollectionOrigin('acme/collections/react.collection.json', 'develop');
    expect(result).toEqual({
      type: 'url',
      url: 'https://raw.githubusercontent.com/acme/collections/develop/react.collection.json',
      owner: 'acme',
      repo: 'collections',
      path: 'react.collection.json',
      ref: 'develop',
    });
  });

  it('parses a local file path', () => {
    const result = parseCollectionOrigin('./react.collection.json');
    expect(result).toEqual({ type: 'local', path: './react.collection.json' });
  });

  it('parses a Windows-style local path', () => {
    const result = parseCollectionOrigin('C:\\collections\\react.collection.json');
    expect(result).toEqual({ type: 'local', path: 'C:\\collections\\react.collection.json' });
  });

  it('treats an existing local file with 3+ segments as local, not GitHub shorthand', () => {
    // Create a file that looks like org/repo/path
    const nestedDir = join(testDir, 'org', 'repo');
    mkdirSync(nestedDir, { recursive: true });
    const filePath = join(nestedDir, 'file.json');
    writeFileSync(filePath, '{}');

    const result = parseCollectionOrigin(filePath);
    expect(result).toEqual({ type: 'local', path: filePath });
  });
});

// ─── loadCollection ───────────────────────────────────────────────────────────

describe('loadCollection', () => {
  it('loads a valid local collection file', async () => {
    const collectionPath = join(testDir, 'test.collection.json');
    writeFileSync(collectionPath, JSON.stringify({
      sources: [
        { name: 'A', repo: 'acme/a', branch: 'main', remotePath: '', localOutput: '.' },
      ],
    }));

    const result = await loadCollection({ type: 'local', path: collectionPath });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].repo).toBe('acme/a');
    expect(result.originLabel).toBe(collectionPath);
  });

  it('throws when local file does not exist', async () => {
    await expect(
      loadCollection({ type: 'local', path: '/nonexistent.json' })
    ).rejects.toThrow('File not found');
  });

  it('throws on invalid JSON', async () => {
    const path = join(testDir, 'bad.json');
    writeFileSync(path, 'not json');

    await expect(
      loadCollection({ type: 'local', path })
    ).rejects.toThrow('not valid JSON');
  });

  it('throws when sources array is missing', async () => {
    const path = join(testDir, 'empty.json');
    writeFileSync(path, JSON.stringify({ repo: 'acme/a' }));

    await expect(
      loadCollection({ type: 'local', path })
    ).rejects.toThrow('does not contain a valid "sources" array');
  });

  it('throws when sources array is empty', async () => {
    const path = join(testDir, 'empty-sources.json');
    writeFileSync(path, JSON.stringify({ sources: [] }));

    await expect(
      loadCollection({ type: 'local', path })
    ).rejects.toThrow('does not contain a valid "sources" array');
  });

  it('throws when a source is missing repo field', async () => {
    const path = join(testDir, 'bad-source.json');
    writeFileSync(path, JSON.stringify({
      sources: [{ name: 'A', branch: 'main', remotePath: '', localOutput: '.' }],
    }));

    await expect(
      loadCollection({ type: 'local', path })
    ).rejects.toThrow('missing a valid "repo" field');
  });

  it('throws when a source is missing branch field', async () => {
    const path = join(testDir, 'no-branch.json');
    writeFileSync(path, JSON.stringify({
      sources: [{ name: 'A', repo: 'acme/a', remotePath: '', localOutput: '.' }],
    }));

    await expect(
      loadCollection({ type: 'local', path })
    ).rejects.toThrow('missing a valid "branch" field');
  });

  it('loads from a GitHub URL via fetchFileContent', async () => {
    const content = JSON.stringify({
      sources: [
        { name: 'Remote', repo: 'org/remote', branch: 'main', remotePath: '', localOutput: '.' },
      ],
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (h: string) => h === 'X-RateLimit-Remaining' ? '60' : '0' },
      json: () => Promise.resolve({
        type: 'file',
        path: 'react.collection.json',
        sha: 'abc',
        size: content.length,
        encoding: 'base64',
        content: Buffer.from(content).toString('base64'),
      }),
    }));

    const result = await loadCollection({
      type: 'url',
      url: 'https://raw.githubusercontent.com/org/collections/main/react.collection.json',
      owner: 'org',
      repo: 'collections',
      path: 'react.collection.json',
      ref: 'main',
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].repo).toBe('org/remote');
    expect(result.originLabel).toBe('https://raw.githubusercontent.com/org/collections/main/react.collection.json');
  });
});

// ─── sourceKey ────────────────────────────────────────────────────────────────

describe('sourceKey', () => {
  it('builds key from repo, remotePath, and branch', () => {
    expect(sourceKey(makeSource())).toBe('acme/agents::::main');
    expect(sourceKey(makeSource({ remotePath: 'agents' }))).toBe('acme/agents::agents::main');
    expect(sourceKey(makeSource({ branch: 'dev' }))).toBe('acme/agents::::dev');
  });
});

// ─── checkDuplicates ──────────────────────────────────────────────────────────

describe('checkDuplicates', () => {
  it('identifies exact duplicates', () => {
    const existing = [makeSource()];
    const incoming = [makeSource()];
    const result = checkDuplicates(incoming, existing);
    expect(result.skipped).toHaveLength(1);
    expect(result.toAdd).toHaveLength(0);
  });

  it('allows sources with different remotePath', () => {
    const existing = [makeSource({ remotePath: 'agents' })];
    const incoming = [makeSource({ remotePath: 'prompts' })];
    const result = checkDuplicates(incoming, existing);
    expect(result.toAdd).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it('allows sources with different branch', () => {
    const existing = [makeSource({ branch: 'main' })];
    const incoming = [makeSource({ branch: 'develop' })];
    const result = checkDuplicates(incoming, existing);
    expect(result.toAdd).toHaveLength(1);
  });

  it('detects name conflicts', () => {
    const existing = [makeSource({ name: 'Agents' })];
    const incoming = [makeSource({ name: 'Agents', remotePath: 'different' })];
    const result = checkDuplicates(incoming, existing);
    expect(result.nameConflicts).toHaveLength(1);
    expect(result.toAdd).toHaveLength(1); // still in toAdd, conflict handled separately
  });

  it('deduplicates within incoming list', () => {
    const existing: SourceConfig[] = [];
    const incoming = [makeSource(), makeSource()];
    const result = checkDuplicates(incoming, existing);
    expect(result.toAdd).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  it('handles mixed duplicates and new sources', () => {
    const existing = [makeSource()];
    const incoming = [
      makeSource(), // duplicate
      makeSource({ repo: 'acme/new', name: 'New' }), // new
    ];
    const result = checkDuplicates(incoming, existing);
    expect(result.skipped).toHaveLength(1);
    expect(result.toAdd).toHaveLength(1);
    expect(result.toAdd[0].repo).toBe('acme/new');
  });
});

// ─── backupConfig ─────────────────────────────────────────────────────────────

describe('backupConfig', () => {
  it('creates a .bak file when config exists', () => {
    saveConfig({ sources: [makeSource()] }, testDir);
    const backupPath = backupConfig(testDir);
    expect(backupPath).toBe(join(testDir, `${CONFIG_FILE}.bak`));
    expect(existsSync(backupPath!)).toBe(true);
    const original = readFileSync(join(testDir, CONFIG_FILE), 'utf8');
    const backup = readFileSync(backupPath!, 'utf8');
    expect(backup).toBe(original);
  });

  it('returns null when no config exists', () => {
    const result = backupConfig(join(testDir, 'nonexistent'));
    expect(result).toBeNull();
  });
});

// ─── Asset helpers ────────────────────────────────────────────────────────────

function makeAsset(overrides: Partial<CollectionAsset> = {}): CollectionAsset {
  return {
    repo: 'acme/agents', branch: 'main', path: 'skills/react/SKILL.md', defaultOutput: '.github/skills',
    ...overrides,
  };
}

// ─── assetKey ─────────────────────────────────────────────────────────────────

describe('assetKey', () => {
  it('builds key from repo and path', () => {
    expect(assetKey(makeAsset())).toBe('acme/agents::skills/react/SKILL.md');
  });

  it('uses different paths for different assets', () => {
    const a = assetKey(makeAsset({ path: 'a.md' }));
    const b = assetKey(makeAsset({ path: 'b.md' }));
    expect(a).not.toBe(b);
  });
});

// ─── loadAssetCollection ──────────────────────────────────────────────────────

describe('loadAssetCollection', () => {
  it('loads a valid local asset collection', async () => {
    const filePath = join(testDir, 'react.collection.json');
    writeFileSync(filePath, JSON.stringify({
      name: 'React Kit',
      description: 'Curated React assets',
      assets: [makeAsset()],
    }));

    const { collection, originLabel } = await loadAssetCollection({ type: 'local', path: filePath });
    expect(collection.name).toBe('React Kit');
    expect(collection.description).toBe('Curated React assets');
    expect(collection.assets).toHaveLength(1);
    expect(originLabel).toBe(filePath);
  });

  it('sets description to undefined when not a string', async () => {
    const filePath = join(testDir, 'no-desc.collection.json');
    writeFileSync(filePath, JSON.stringify({
      name: 'Minimal',
      assets: [makeAsset()],
    }));

    const { collection } = await loadAssetCollection({ type: 'local', path: filePath });
    expect(collection.description).toBeUndefined();
  });

  it('throws when local file does not exist', async () => {
    await expect(
      loadAssetCollection({ type: 'local', path: '/nonexistent.json' })
    ).rejects.toThrow('File not found');
  });

  it('throws on invalid JSON', async () => {
    const filePath = join(testDir, 'bad.json');
    writeFileSync(filePath, 'not json');

    await expect(
      loadAssetCollection({ type: 'local', path: filePath })
    ).rejects.toThrow('not valid JSON');
  });

  it('throws when name field is missing', async () => {
    const filePath = join(testDir, 'no-name.json');
    writeFileSync(filePath, JSON.stringify({ assets: [makeAsset()] }));

    await expect(
      loadAssetCollection({ type: 'local', path: filePath })
    ).rejects.toThrow('missing a valid "name" field');
  });

  it('throws when assets array is missing', async () => {
    const filePath = join(testDir, 'no-assets.json');
    writeFileSync(filePath, JSON.stringify({ name: 'Test' }));

    await expect(
      loadAssetCollection({ type: 'local', path: filePath })
    ).rejects.toThrow('does not contain a valid "assets" array');
  });

  it('throws when assets array is empty', async () => {
    const filePath = join(testDir, 'empty-assets.json');
    writeFileSync(filePath, JSON.stringify({ name: 'Test', assets: [] }));

    await expect(
      loadAssetCollection({ type: 'local', path: filePath })
    ).rejects.toThrow('does not contain a valid "assets" array');
  });

  it('throws when asset is missing repo', async () => {
    const filePath = join(testDir, 'bad-asset.json');
    writeFileSync(filePath, JSON.stringify({
      name: 'Test',
      assets: [{ branch: 'main', path: 'a.md', defaultOutput: '.' }],
    }));

    await expect(
      loadAssetCollection({ type: 'local', path: filePath })
    ).rejects.toThrow('Asset at index 0');
    await expect(
      loadAssetCollection({ type: 'local', path: filePath })
    ).rejects.toThrow('missing a valid "repo" field');
  });

  it('throws when asset is missing branch', async () => {
    const filePath = join(testDir, 'no-branch.json');
    writeFileSync(filePath, JSON.stringify({
      name: 'Test',
      assets: [{ repo: 'acme/a', path: 'a.md', defaultOutput: '.' }],
    }));

    await expect(
      loadAssetCollection({ type: 'local', path: filePath })
    ).rejects.toThrow('missing a valid "branch" field');
  });

  it('throws when asset is missing path', async () => {
    const filePath = join(testDir, 'no-path.json');
    writeFileSync(filePath, JSON.stringify({
      name: 'Test',
      assets: [{ repo: 'acme/a', branch: 'main', defaultOutput: '.' }],
    }));

    await expect(
      loadAssetCollection({ type: 'local', path: filePath })
    ).rejects.toThrow('missing a valid "path" field');
  });

  it('throws when asset is missing defaultOutput', async () => {
    const filePath = join(testDir, 'no-output.json');
    writeFileSync(filePath, JSON.stringify({
      name: 'Test',
      assets: [{ repo: 'acme/a', branch: 'main', path: 'a.md' }],
    }));

    await expect(
      loadAssetCollection({ type: 'local', path: filePath })
    ).rejects.toThrow('missing a valid "defaultOutput" field');
  });

  it('loads from a GitHub URL via fetchFileContent', async () => {
    const collection = {
      name: 'Remote Kit',
      assets: [makeAsset()],
    };
    const content = JSON.stringify(collection);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (h: string) => h === 'X-RateLimit-Remaining' ? '60' : '0' },
      json: () => Promise.resolve({
        type: 'file',
        path: 'react.collection.json',
        sha: 'abc',
        size: content.length,
        encoding: 'base64',
        content: Buffer.from(content).toString('base64'),
      }),
    }));

    const result = await loadAssetCollection({
      type: 'url',
      url: 'https://raw.githubusercontent.com/org/repo/main/react.collection.json',
      owner: 'org',
      repo: 'repo',
      path: 'react.collection.json',
      ref: 'main',
    });

    expect(result.collection.name).toBe('Remote Kit');
    expect(result.originLabel).toBe('https://raw.githubusercontent.com/org/repo/main/react.collection.json');
  });
});

// ─── groupByOutput ────────────────────────────────────────────────────────────

describe('groupByOutput', () => {
  it('groups assets by resolved output', () => {
    const a1 = makeAsset({ path: 'a.md', defaultOutput: '.github/skills' });
    const a2 = makeAsset({ path: 'b.md', defaultOutput: '.github/skills' });
    const a3 = makeAsset({ path: 'c.md', defaultOutput: 'scripts' });

    const resolved = new Map<string, string>();
    resolved.set(assetKey(a1), '.claude/skills');
    resolved.set(assetKey(a2), '.claude/skills');
    resolved.set(assetKey(a3), 'scripts');

    const groups = groupByOutput([a1, a2, a3], resolved);
    expect(groups.size).toBe(2);
    expect(groups.get('.claude/skills')).toHaveLength(2);
    expect(groups.get('scripts')).toHaveLength(1);
  });

  it('falls back to defaultOutput when no resolved mapping', () => {
    const a1 = makeAsset({ path: 'a.md', defaultOutput: '.github/skills' });
    const groups = groupByOutput([a1], new Map());
    expect(groups.get('.github/skills')).toHaveLength(1);
  });

  it('returns empty map for empty assets', () => {
    const groups = groupByOutput([], new Map());
    expect(groups.size).toBe(0);
  });
});
