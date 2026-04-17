import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync:    vi.fn(() => false),
    readFileSync:  vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    mkdirSync:     vi.fn(),
  };
});

vi.mock('os', () => ({
  homedir: () => '/mock-home',
}));

vi.mock('../lib/config.js', () => ({
  loadConfig:       vi.fn(() => ({})),
  parseRepoString:  vi.fn((repo: string) => {
    const [owner, name] = repo.split('/');
    return { owner, repo: name };
  }),
  resolvedSources:  vi.fn(() => []),
}));

vi.mock('../lib/github.js', () => ({
  fetchAllFiles: vi.fn(async () => []),
}));

vi.mock('../lib/filter.js', () => ({
  filterFiles: vi.fn((files: unknown[]) => files),
}));

import { writeCompletionCache, getCompletions, cwdHash, refreshCompletionCache } from '../lib/completionCache.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolvedSources } from '../lib/config.js';
import { fetchAllFiles } from '../lib/github.js';
import { filterFiles } from '../lib/filter.js';

const mockFiles = [
  'agents/summarizer.md',
  'agents/classifier.md',
  'prompts/system-prompt.txt',
  'prompts/user-prompt.txt',
];

describe('completion cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── writeCompletionCache ────────────────────────────────────────────────────

  it('writes file paths to the cache under the cwd key', () => {
    writeCompletionCache(mockFiles, '/my/project');
    const jsonCall = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as string).endsWith('completions.json'),
    );
    expect(jsonCall).toBeDefined();
    const written = JSON.parse(jsonCall![1] as string);
    expect(written['/my/project'].files).toEqual(mockFiles);
  });

  it('writes a plain-text companion file for shell completion', () => {
    writeCompletionCache(mockFiles, '/my/project');
    const txtCall = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as string).endsWith('.txt'),
    );
    expect(txtCall).toBeDefined();
    expect(txtCall![1]).toBe(mockFiles.join('\n'));
    expect((txtCall![0] as string)).toContain(join('completions', `${cwdHash('/my/project')}.txt`));
  });

  it('creates the cache directory if it does not exist', () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    writeCompletionCache(mockFiles, '/my/project');
    expect(mkdirSync).toHaveBeenCalledWith(join(homedir(), '.synap'), { recursive: true });
  });

  it('does not create cache directory if it already exists', () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('{}');
    writeCompletionCache(mockFiles, '/my/project');
    expect(mkdirSync).not.toHaveBeenCalled();
  });

  // ── getCompletions ──────────────────────────────────────────────────────────

  it('returns matches for a partial string from the cache', () => {
    const cacheData = {
      '/my/project': { files: mockFiles, cachedAt: new Date().toISOString() },
    };
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(cacheData));

    expect(getCompletions('summ', '/my/project')).toEqual(['agents/summarizer.md']);
  });

  it('matches on filename portion of path', () => {
    const cacheData = {
      '/my/project': { files: mockFiles, cachedAt: new Date().toISOString() },
    };
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(cacheData));

    expect(getCompletions('system', '/my/project')).toContain('prompts/system-prompt.txt');
  });

  it('returns all files for empty partial string', () => {
    const cacheData = {
      '/my/project': { files: mockFiles, cachedAt: new Date().toISOString() },
    };
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(cacheData));

    expect(getCompletions('', '/my/project')).toHaveLength(mockFiles.length);
  });

  it('returns empty array when cache file does not exist', () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    expect(getCompletions('summ', '/my/project')).toEqual([]);
  });

  it('returns empty array when cwd has no entry in cache', () => {
    const cacheData = {
      '/other/project': { files: mockFiles, cachedAt: new Date().toISOString() },
    };
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(cacheData));

    expect(getCompletions('summ', '/my/project')).toEqual([]);
  });

  it('returns empty array when readFileSync throws (corrupt cache file)', () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('read error'); });

    expect(getCompletions('summ', '/my/project')).toEqual([]);
  });

  // ── cwdHash ───────────────────────────────────────────────────────────────

  it('cwdHash normalises Windows paths to Unix format before hashing', () => {
    // C:\Users\foo and /c/Users/foo should produce the same hash
    const winHash  = cwdHash('C:\\Users\\foo');
    const unixHash = cwdHash('/c/Users/foo');
    expect(winHash).toBe(unixHash);
  });

  it('cwdHash leaves Unix paths unchanged', () => {
    const a = cwdHash('/Users/foo');
    const b = cwdHash('/Users/foo');
    expect(a).toBe(b);
    // Sanity: it should be a 32-char hex string
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  // ── refreshCompletionCache ────────────────────────────────────────────────

  it('fetches files from all sources and writes the cache', async () => {
    vi.mocked(resolvedSources).mockReturnValue([
      { name: 'test', repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.' },
    ]);
    vi.mocked(fetchAllFiles).mockResolvedValue([
      { path: 'agents/summarizer.md', sha: 'abc', type: 'blob' },
      { path: 'agents/classifier.md', sha: 'def', type: 'blob' },
    ]);
    vi.mocked(filterFiles).mockReturnValue([
      { path: 'agents/summarizer.md', sha: 'abc', type: 'blob' },
      { path: 'agents/classifier.md', sha: 'def', type: 'blob' },
    ]);

    await refreshCompletionCache();

    expect(fetchAllFiles).toHaveBeenCalledWith({ owner: 'acme', repo: 'agents', path: '', ref: 'main' });
    const jsonCall = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as string).endsWith('completions.json'),
    );
    expect(jsonCall).toBeDefined();
  });

  it('silently ignores errors during refresh', async () => {
    vi.mocked(resolvedSources).mockImplementation(() => { throw new Error('config broken'); });
    await expect(refreshCompletionCache()).resolves.toBeUndefined();
  });

  it('defaults to branch "main" and empty remotePath when source omits them', async () => {
    vi.mocked(resolvedSources).mockReturnValue([
      { name: 'bare', repo: 'acme/bare', branch: '', remotePath: '', localOutput: '.' },
    ]);
    vi.mocked(fetchAllFiles).mockResolvedValue([]);
    vi.mocked(filterFiles).mockReturnValue([]);

    await refreshCompletionCache();

    expect(fetchAllFiles).toHaveBeenCalledWith({ owner: 'acme', repo: 'bare', path: '', ref: 'main' });
  });
});
