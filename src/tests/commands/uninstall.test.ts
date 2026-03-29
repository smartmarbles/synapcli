import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

// CACHE_DIR in uninstall.ts is join(homedir(), '.synap') computed at module load time.
// Use a constant path so it matches what the module baked in.
// Cross-platform temp path — process.env.TEMP is set on Windows, TMPDIR on Unix
const MOCK_HOME = join(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp', 'synap-test-home-uninstall');

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('os', async (importOriginal) => {
  const { join } = await import('path');
  const actual = await importOriginal<typeof import('os')>();
  const mockHome = join(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp', 'synap-test-home-uninstall');
  return { ...actual, homedir: vi.fn().mockReturnValue(mockHome) };
});

import { execSync }     from 'child_process';
import { runUninstall } from '../../commands/uninstall.js';

beforeEach(() => {
  mkdirSync(MOCK_HOME, { recursive: true });
  mkdirSync(join(MOCK_HOME, '.config', 'fish'), { recursive: true });
  mkdirSync(join(MOCK_HOME, 'Documents', 'PowerShell'), { recursive: true });

  vi.mocked(execSync).mockReturnValue(
    join(MOCK_HOME, 'Documents', 'PowerShell', 'profile.ps1') as unknown as Buffer
  );

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  rmSync(MOCK_HOME, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const SYNAP_BLOCK = `

# SynapCLI bash completion
_synap_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
}
complete -F _synap_completions synap
`;

describe('runUninstall', () => {
  it('reports nothing to remove when no profile files exist', () => {
    const consoleSpy = vi.spyOn(console, 'log');
    runUninstall();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No SynapCLI completion scripts found'));
  });

  it('reports nothing to remove when profile files exist but have no SynapCLI block', () => {
    writeFileSync(join(MOCK_HOME, '.bashrc'), '# existing .bashrc content\nexport PATH=$PATH:/usr/local/bin\n');
    const consoleSpy = vi.spyOn(console, 'log');
    runUninstall();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No SynapCLI completion scripts found'));
  });

  it('removes SynapCLI block from .bashrc and reports success', () => {
    const bashrc = join(MOCK_HOME, '.bashrc');
    writeFileSync(bashrc, `# before${SYNAP_BLOCK}\n# after\n`);

    const consoleSpy = vi.spyOn(console, 'log');
    runUninstall();

    const remaining = readFileSync(bashrc, 'utf8');
    expect(remaining).not.toContain('SynapCLI');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Removed SynapCLI completion from'));
  });

  it('removes SynapCLI block from .zshrc', () => {
    const zshrc = join(MOCK_HOME, '.zshrc');
    writeFileSync(zshrc, `# top${SYNAP_BLOCK}`);

    runUninstall();

    const remaining = readFileSync(zshrc, 'utf8');
    expect(remaining).not.toContain('SynapCLI');
  });

  it('removes SynapCLI block from fish config', () => {
    const fishDir = join(MOCK_HOME, '.config', 'fish');
    mkdirSync(fishDir, { recursive: true });
    const fishConfig = join(fishDir, 'config.fish');
    writeFileSync(fishConfig, `# fish config${SYNAP_BLOCK}`);

    runUninstall();

    const remaining = readFileSync(fishConfig, 'utf8');
    expect(remaining).not.toContain('SynapCLI');
  });

  it('removes ~/.synap cache directory if it exists', () => {
    const cacheDir = join(MOCK_HOME, '.synap');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'completions.json'), '{}');

    const consoleSpy = vi.spyOn(console, 'log');
    runUninstall();

    expect(existsSync(cacheDir)).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Removed SynapCLI cache directory'));
  });

  it('does not throw when cache directory does not exist', () => {
    expect(() => runUninstall()).not.toThrow();
  });

  it('uses fallback PowerShell profile path when execSync throws in getPowerShellProfile', () => {
    vi.mocked(execSync).mockImplementationOnce(() => { throw new Error('pwsh not found'); });

    // Should not throw — catch block returns fallback path, rest of runUninstall runs fine
    const consoleSpy = vi.spyOn(console, 'log');
    expect(() => runUninstall()).not.toThrow();
    // No SynapCLI found in any profile (fallback path file doesn't exist either)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No SynapCLI completion scripts found'));
  });

  it('preserves content before and after the SynapCLI block', () => {
    const bashrc = join(MOCK_HOME, '.bashrc');
    const before = '# top of bashrc\nexport EDITOR=vim\n';
    const after  = '\n# bottom section\nexport FOO=bar\n';
    writeFileSync(bashrc, before + SYNAP_BLOCK + after);

    runUninstall();

    const remaining = readFileSync(bashrc, 'utf8');
    expect(remaining).toContain('EDITOR=vim');
    expect(remaining).toContain('FOO=bar');
    expect(remaining).not.toContain('SynapCLI');
  });

  it('removes SynapCLI block from PowerShell profile when present', () => {
    const psProfile = join(MOCK_HOME, 'Documents', 'PowerShell', 'profile.ps1');
    mkdirSync(join(MOCK_HOME, 'Documents', 'PowerShell'), { recursive: true });
    // PowerShell script uses braces so depth-tracking logic gets exercised
    writeFileSync(psProfile, `# SynapCLI PowerShell completion\nfunction _SynapGetCompletions {\n  return @()\n}\n`);

    vi.mocked(execSync).mockReturnValue(psProfile as unknown as Buffer);

    const consoleSpy = vi.spyOn(console, 'log');
    runUninstall();

    const remaining = readFileSync(psProfile, 'utf8');
    expect(remaining).not.toContain('SynapCLI');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Removed SynapCLI completion from'));
  });
});
