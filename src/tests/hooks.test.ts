import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';
import { runPostPullHook } from '../lib/hooks.js';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runPostPullHook', () => {
  it('does nothing when command is undefined', () => {
    runPostPullHook(undefined);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('does nothing when command is empty string', () => {
    runPostPullHook('');
    expect(execSync).not.toHaveBeenCalled();
  });

  it('runs the command via execSync with inherit stdio', () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    runPostPullHook('echo done');
    expect(execSync).toHaveBeenCalledWith('echo done', expect.objectContaining({
      stdio: 'inherit',
      cwd: process.cwd(),
    }));
  });

  it('logs success after running the command', () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(''));
    const consoleSpy = vi.spyOn(console, 'log');
    runPostPullHook('echo done');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Postpull hook completed'));
  });

  it('logs a warning when execSync throws but does not rethrow', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('Command failed'); });
    const consoleSpy = vi.spyOn(console, 'log');
    expect(() => runPostPullHook('false')).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Postpull hook exited with an error'));
  });
});
