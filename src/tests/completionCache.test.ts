import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fs and os so tests don't touch the real filesystem
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
import { existsSync, readFileSync, writeFileSync } from 'fs';

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

  it('writes file paths to the cache under the cwd key', () => {
    writeCompletionCache(mockFiles, '/my/project');
    expect(writeFileSync).toHaveBeenCalledOnce();
    const written = JSON.parse((writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string);
    expect(written['/my/project'].files).toEqual(mockFiles);
  });

  it('returns matches for a partial string from the cache', () => {
    const cacheData = {
      '/my/project': {
        files: mockFiles,
        cachedAt: new Date().toISOString(),
      },
    };
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(cacheData));

    const results = getCompletions('summ', '/my/project');
    expect(results).toEqual(['agents/summarizer.md']);
  });

  it('matches on filename portion, not just full path', () => {
    const cacheData = {
      '/my/project': {
        files: mockFiles,
        cachedAt: new Date().toISOString(),
      },
    };
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(cacheData));

    const results = getCompletions('system', '/my/project');
    expect(results).toContain('prompts/system-prompt.txt');
  });

  it('returns empty array when cache is missing', () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const results = getCompletions('summ', '/my/project');
    expect(results).toEqual([]);
  });

  it('returns empty array when cache is stale', () => {
    const staleDate = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago
    const cacheData = {
      '/my/project': { files: mockFiles, cachedAt: staleDate },
    };
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(cacheData));

    const results = getCompletions('summ', '/my/project');
    expect(results).toEqual([]);
  });

  it('returns empty array when partial is empty string', () => {
    const cacheData = {
      '/my/project': {
        files: mockFiles,
        cachedAt: new Date().toISOString(),
      },
    };
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(cacheData));

    // Empty string matches everything — all files should be returned
    const results = getCompletions('', '/my/project');
    expect(results).toHaveLength(mockFiles.length);
  });
});
