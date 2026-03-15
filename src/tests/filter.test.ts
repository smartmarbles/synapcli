import { describe, it, expect } from 'vitest';
import { filterFiles } from '../lib/filter.js';
import type { RemoteFile, SourceConfig } from '../types.js';

const files: RemoteFile[] = [
  { path: 'agents/summarizer.md', sha: 'a1', size: 100 },
  { path: 'agents/classifier.md', sha: 'b2', size: 200 },
  { path: 'prompts/system.txt',   sha: 'c3', size: 50  },
  { path: 'prompts/user.txt',     sha: 'd4', size: 60  },
  { path: 'tests/fixture.md',     sha: 'e5', size: 10  },
];

const baseSource: SourceConfig = {
  repo: 'acme/agents',
  branch: 'main',
  remotePath: '',
  localOutput: 'src',
};

describe('filterFiles', () => {
  it('returns all files when no patterns are set', () => {
    const result = filterFiles(files, baseSource);
    expect(result).toHaveLength(5);
  });

  it('applies include glob patterns', () => {
    const source: SourceConfig = { ...baseSource, include: ['agents/**'] };
    const result = filterFiles(files, source);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.path)).toEqual([
      'agents/summarizer.md',
      'agents/classifier.md',
    ]);
  });

  it('applies exclude glob patterns', () => {
    const source: SourceConfig = { ...baseSource, exclude: ['tests/**'] };
    const result = filterFiles(files, source);
    expect(result).toHaveLength(4);
    expect(result.find((f) => f.path === 'tests/fixture.md')).toBeUndefined();
  });

  it('applies both include and exclude patterns', () => {
    const source: SourceConfig = {
      ...baseSource,
      include: ['**/*.md'],
      exclude: ['tests/**'],
    };
    const result = filterFiles(files, source);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.path)).toEqual([
      'agents/summarizer.md',
      'agents/classifier.md',
    ]);
  });

  it('returns empty array when nothing matches include', () => {
    const source: SourceConfig = { ...baseSource, include: ['nonexistent/**'] };
    const result = filterFiles(files, source);
    expect(result).toHaveLength(0);
  });
});
