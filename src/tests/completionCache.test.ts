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

import { writeCompletionCache, getCompletions } from '../lib/completionCache.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

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
    expect(writeFileSync).toHaveBeenCalledOnce();
    const written = JSON.parse((writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string);
    expect(written['/my/project'].files).toEqual(mockFiles);
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

  it('returns empty array when cache is stale', () => {
    const staleDate = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const cacheData = { '/my/project': { files: mockFiles, cachedAt: staleDate } };
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(cacheData));

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
});
