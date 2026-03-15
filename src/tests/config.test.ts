import { describe, it, expect } from 'vitest';
import { parseRepoString, lockKey, resolvedSources } from '../lib/config.js';
import type { SynapConfig } from '../types.js';

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

  it('throws on invalid format', () => {
    expect(() => parseRepoString('not-a-repo')).toThrow();
    expect(() => parseRepoString('')).toThrow();
  });
});

describe('lockKey', () => {
  it('namespaces a file path under its repo', () => {
    expect(lockKey('acme/agents', 'summarizer.md')).toBe('acme/agents::summarizer.md');
  });

  it('handles nested paths', () => {
    expect(lockKey('acme/agents', 'deep/nested/file.md')).toBe('acme/agents::deep/nested/file.md');
  });
});

describe('resolvedSources', () => {
  it('returns sources array when present', () => {
    const config: SynapConfig = {
      sources: [
        { repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: 'src/agents' },
      ],
    };
    const sources = resolvedSources(config);
    expect(sources).toHaveLength(1);
    expect(sources[0].repo).toBe('acme/agents');
  });

  it('normalises legacy single-source config', () => {
    const config: SynapConfig = {
      repo: 'acme/agents',
      branch: 'main',
      remotePath: 'agents',
      localOutput: 'src/agents',
    };
    const sources = resolvedSources(config);
    expect(sources).toHaveLength(1);
    expect(sources[0].repo).toBe('acme/agents');
    expect(sources[0].remotePath).toBe('agents');
  });

  it('throws when neither repo nor sources are set', () => {
    expect(() => resolvedSources({} as SynapConfig)).toThrow();
  });
});
