import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

// SHELL_CONFIG in completion.ts is evaluated at module load time via homedir().
// The mock must return a constant path so those baked-in paths are predictable.
// Cross-platform temp path — process.env.TEMP is set on Windows, TMPDIR on Unix
const MOCK_HOME = join(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp', 'synap-test-home-completion');

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('os', async (importOriginal) => {
  const { join } = await import('path');
  const actual = await importOriginal<typeof import('os')>();
  const mockHome = join(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp', 'synap-test-home-completion');
  return { ...actual, homedir: vi.fn().mockReturnValue(mockHome) };
});

vi.mock('@clack/prompts', () => ({
  intro:    vi.fn(),
  outro:    vi.fn(),
  select:   vi.fn(),
  confirm:  vi.fn(),
  cancel:   vi.fn(),
  isCancel: vi.fn(() => false),
}));

import { execSync }          from 'child_process';
import * as p                from '@clack/prompts';
import { completionCommand } from '../../commands/completion.js';

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Create the home dir and all shell-config parent dirs upfront
  mkdirSync(MOCK_HOME, { recursive: true });
  mkdirSync(join(MOCK_HOME, '.config', 'fish'), { recursive: true });
  mkdirSync(join(MOCK_HOME, 'Documents', 'PowerShell'), { recursive: true });
  mkdirSync(join(MOCK_HOME, 'Documents', 'WindowsPowerShell'), { recursive: true });

  vi.mocked(execSync).mockReturnValue(
    join(MOCK_HOME, 'Documents', 'PowerShell', 'profile.ps1') as unknown as Buffer
  );

  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  });

  delete process.env.SHELL;
  delete process.env.PSModulePath;
  delete process.env.PSVersionTable;
});

afterEach(() => {
  rmSync(MOCK_HOME, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();
  delete process.env.SHELL;
  delete process.env.PSModulePath;
  delete process.env.PSVersionTable;
});

// ── Print mode (shell given, no --install) ────────────────────────────────────

describe('completionCommand — print mode', () => {
  it('prints bash script when shell is "bash"', async () => {
    await completionCommand('bash', {});
    const printed = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toContain('_synap_completions');
    expect(printed).toContain('complete -F _synap_completions synap');
  });

  it('prints zsh script when shell is "zsh"', async () => {
    await completionCommand('zsh', {});
    const printed = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toContain('_synap');
    expect(printed).toContain('compdef');
  });

  it('prints fish script when shell is "fish"', async () => {
    await completionCommand('fish', {});
    const printed = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toContain('__synap_file_completions');
  });

  it('prints powershell script when shell is "powershell"', async () => {
    await completionCommand('powershell', {});
    const printed = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toContain('_SynapGetCompletions');
  });

  it('shell name matching is case-insensitive', async () => {
    await completionCommand('BASH', {});
    const printed = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toContain('_synap_completions');
  });

  const ALL_COMMANDS = ['init', 'pull', 'list', 'status', 'diff', 'update', 'delete', 'doctor', 'completion', 'register', 'deregister', 'install', 'collection'];

  it.each(['bash', 'zsh', 'fish', 'powershell'])('"%s" script includes all CLI commands', async (shell) => {
    await completionCommand(shell, {});
    const printed = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    for (const cmd of ALL_COMMANDS) {
      expect(printed).toContain(cmd);
    }
  });

  it.each(['bash', 'zsh', 'fish'])('"%s" script includes "collection create" subcommand', async (shell) => {
    await completionCommand(shell, {});
    const printed = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toContain('create');
  });

  it('exits with code 1 for unknown shell in print mode', async () => {
    await expect(completionCommand('fish2000', {})).rejects.toThrow('exit:1');
  });
});

// ── Install mode ──────────────────────────────────────────────────────────────

describe('completionCommand — install mode', () => {
  it('appends bash completion script to .bashrc', async () => {
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand('bash', { install: true });

    const bashrc = join(MOCK_HOME, '.bashrc');
    expect(existsSync(bashrc)).toBe(true);
    expect(readFileSync(bashrc, 'utf8')).toContain('SynapCLI');
  });

  it('appends zsh completion script to .zshrc', async () => {
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand('zsh', { install: true });

    expect(existsSync(join(MOCK_HOME, '.zshrc'))).toBe(true);
  });

  it('appends fish completion script to config.fish', async () => {
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand('fish', { install: true });

    expect(existsSync(join(MOCK_HOME, '.config', 'fish', 'config.fish'))).toBe(true);
  });

  it('detects bash from SHELL env var (sets detectedShell hint on select)', async () => {
    process.env.SHELL = '/bin/bash';
    vi.mocked(p.select).mockResolvedValueOnce('bash');
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand(undefined, { install: true });

    expect(existsSync(join(MOCK_HOME, '.bashrc'))).toBe(true);
  });

  it('detects zsh from SHELL env var', async () => {
    process.env.SHELL = '/usr/local/bin/zsh';
    vi.mocked(p.select).mockResolvedValueOnce('zsh');
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand(undefined, { install: true });

    expect(existsSync(join(MOCK_HOME, '.zshrc'))).toBe(true);
  });

  it('detects fish from SHELL env var', async () => {
    process.env.SHELL = '/usr/bin/fish';
    vi.mocked(p.select).mockResolvedValueOnce('fish');
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand(undefined, { install: true });

    expect(existsSync(join(MOCK_HOME, '.config', 'fish', 'config.fish'))).toBe(true);
  });

  it('detects powershell via PSModulePath env var', async () => {
    process.env.PSModulePath = 'C:\\Windows\\system32\\WindowsPowerShell';
    vi.mocked(p.select).mockResolvedValueOnce('powershell');
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand(undefined, { install: true });

    expect(existsSync(join(MOCK_HOME, 'Documents', 'PowerShell', 'profile.ps1'))).toBe(true);
  });

  it('detects powershell via PSVersionTable env var', async () => {
    // Pass shell explicitly to avoid p.select Symbol mock-ordering issues.
    // detectShell() is still called and exercises the PSVersionTable branch.
    process.env.PSVersionTable = '1';
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand('powershell', { install: true });

    expect(existsSync(join(MOCK_HOME, 'Documents', 'PowerShell', 'profile.ps1'))).toBe(true);
  });

  it('detects no shell (null) when no env vars set — falls back to select', async () => {
    vi.mocked(p.select).mockResolvedValueOnce('bash');
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand(undefined, { install: true });

    expect(existsSync(join(MOCK_HOME, '.bashrc'))).toBe(true);
  });

  it('warns and exits when SynapCLI already installed in config file', async () => {
    writeFileSync(join(MOCK_HOME, '.bashrc'), '# SynapCLI bash completion\n');

    await expect(completionCommand('bash', { install: true })).rejects.toThrow('exit:0');
  });

  it('cancels install when user declines confirmation', async () => {
    vi.mocked(p.confirm).mockResolvedValueOnce(false);

    await expect(completionCommand('bash', { install: true })).rejects.toThrow('exit:0');

    expect(existsSync(join(MOCK_HOME, '.bashrc'))).toBe(false);
  });

  it('exits cleanly when confirm prompt is cancelled via isCancel', async () => {
    vi.mocked(p.isCancel).mockReturnValueOnce(true);
    vi.mocked(p.confirm).mockResolvedValueOnce(Symbol('cancel') as unknown as boolean);

    await expect(completionCommand('bash', { install: true })).rejects.toThrow('exit:0');
  });

  it('select prompt cancel exits cleanly when no shell arg given', async () => {
    vi.mocked(p.isCancel).mockReturnValueOnce(true);
    vi.mocked(p.select).mockResolvedValueOnce(Symbol('cancel') as unknown as string);

    await expect(completionCommand(undefined, { install: true })).rejects.toThrow('exit:0');
  });

  it('exits with code 1 for unknown shell in install mode', async () => {
    await expect(completionCommand('unknownshell', { install: true })).rejects.toThrow('exit:1');
  });

  it('exits with code 1 when writing to config file fails', async () => {
    // Confirm first, then remove the home dir so appendFileSync has nowhere to write
    vi.mocked(p.confirm).mockResolvedValueOnce(true);
    rmSync(MOCK_HOME, { recursive: true, force: true });

    await expect(completionCommand('bash', { install: true })).rejects.toThrow('exit:1');
  });

  it('falls back to default PowerShell profile path when execSync throws', async () => {
    vi.mocked(execSync).mockImplementationOnce(() => { throw new Error('pwsh not found'); });
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand('powershell', { install: true });

    const fallback = join(MOCK_HOME, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1');
    expect(existsSync(fallback)).toBe(true);
  });

  it('shows "Restart PowerShell" message after installing powershell completion', async () => {
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand('powershell', { install: true });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('PowerShell');
  });

  it('shows "Restart fish" message after installing fish completion', async () => {
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand('fish', { install: true });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('fish');
  });

  it('shows "source" message after installing bash completion', async () => {
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand('bash', { install: true });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('source');
  });

  it('creates ~/.bash_profile bridge when no login profile files exist', async () => {
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand('bash', { install: true });

    const bashProfile = join(MOCK_HOME, '.bash_profile');
    expect(existsSync(bashProfile)).toBe(true);
    const content = readFileSync(bashProfile, 'utf8');
    expect(content).toContain('. ~/.bashrc');
    expect(content).toContain('SynapCLI');
  });

  it('does not create ~/.bash_profile when it already exists', async () => {
    writeFileSync(join(MOCK_HOME, '.bash_profile'), '# existing profile\n');
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand('bash', { install: true });

    const content = readFileSync(join(MOCK_HOME, '.bash_profile'), 'utf8');
    expect(content).toBe('# existing profile\n');
  });

  it('does not create ~/.bash_profile when ~/.profile exists', async () => {
    writeFileSync(join(MOCK_HOME, '.profile'), '# existing profile\n');
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand('bash', { install: true });

    expect(existsSync(join(MOCK_HOME, '.bash_profile'))).toBe(false);
  });

  it('shows "automatically in new terminals" after bash install', async () => {
    vi.mocked(p.confirm).mockResolvedValueOnce(true);

    await completionCommand('bash', { install: true });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('automatically in new terminals');
    expect(output).toContain('this session');
  });
});
