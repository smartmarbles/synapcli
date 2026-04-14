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
} from '../lib/collection.js';
import { saveConfig, CONFIG_FILE } from '../lib/config.js';
import type { SourceConfig } from '../types.js';

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
