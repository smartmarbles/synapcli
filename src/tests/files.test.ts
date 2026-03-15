import { describe, it, expect } from 'vitest';
import { resolveLocalPath } from '../utils/files.js';
import { join } from 'path';

describe('resolveLocalPath', () => {
  const cwd = '/project';

  it('strips the remoteBase prefix and prepends localOutput', () => {
    const result = resolveLocalPath({
      remotePath: 'agents/summarizer.md',
      remoteBase: 'agents',
      localOutput: 'src/agents',
      cwd,
    });
    expect(result).toBe(join(cwd, 'src/agents', 'summarizer.md'));
  });

  it('handles files at repo root with no remoteBase', () => {
    const result = resolveLocalPath({
      remotePath: 'summarizer.md',
      remoteBase: '',
      localOutput: 'src/agents',
      cwd,
    });
    expect(result).toBe(join(cwd, 'src/agents', 'summarizer.md'));
  });

  it('handles nested remote paths', () => {
    const result = resolveLocalPath({
      remotePath: 'agents/tools/search.md',
      remoteBase: 'agents',
      localOutput: 'src/agents',
      cwd,
    });
    expect(result).toBe(join(cwd, 'src/agents', 'tools/search.md'));
  });

  it('defaults to cwd when localOutput is empty', () => {
    const result = resolveLocalPath({
      remotePath: 'file.md',
      remoteBase: '',
      localOutput: '.',
      cwd,
    });
    expect(result).toBe(join(cwd, '.', 'file.md'));
  });
});
