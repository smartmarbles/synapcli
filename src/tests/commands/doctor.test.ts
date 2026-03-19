import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: vi.fn() };
});

vi.mock('ora', () => ({
  default: () => ({
    start:   vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail:    vi.fn().mockReturnThis(),
    stop:    vi.fn().mockReturnThis(),
  }),
}));

vi.mock('../../lib/retry.js', () => ({
  withRetry: vi.fn((fn: () => unknown) => fn()),
  sleep:     vi.fn(),
}));

vi.mock('../../utils/files.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/files.js')>();
  return { ...actual };
});

import { execSync }      from 'child_process';
import { homedir }       from 'os';
import { doctorCommand } from '../../commands/doctor.js';
import { saveConfig }    from '../../lib/config.js';
import * as filesUtils   from '../../utils/files.js';
import type { SynapConfig } from '../../types.js';

const OWNER  = 'acme';
const REPO   = 'agents';
const BRANCH = 'main';

function makeHeaders() {
  return { get: (h: string) => h === 'X-RateLimit-Remaining' ? '60' : '0' };
}

function makeOkResponse(data: object) {
  return { ok: true, status: 200, headers: makeHeaders(), json: () => Promise.resolve(data) };
}

function makeErrorResponse(status: number) {
  return { ok: false, status, statusText: 'Error', headers: makeHeaders(), json: () => Promise.resolve({ message: 'error' }) };
}

let testDir: string;
let homeDir: string;
let consoleSpy: ReturnType<typeof vi.spyOn>;

const BASE_CONFIG: SynapConfig = {
  repo: `${OWNER}/${REPO}`, branch: BRANCH, remotePath: '', localOutput: '.',
};

beforeEach(() => {
  testDir = join(tmpdir(), `synap-doctor-${Date.now()}`);
  homeDir = join(testDir, 'home');
  mkdirSync(homeDir, { recursive: true });

  vi.mocked(homedir).mockReturnValue(homeDir);
  // Default: git is available
  vi.mocked(execSync).mockImplementation((cmd: string) => {
    if (String(cmd).startsWith('git --version')) return 'git version 2.43.0' as unknown as Buffer;
    throw new Error('not configured');
  });

  vi.spyOn(process, 'cwd').mockReturnValue(testDir);
  vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  });
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env.GITHUB_TOKEN;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('doctorCommand', () => {
  it('reports missing config and exits early without running further checks', async () => {
    // No config file in testDir
    await doctorCommand();
    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('synap.config.json');
  });

  it('reports node version check (current runtime is always >= 18)', async () => {
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeOkResponse({ login: 'alice' }))   // validateToken
      .mockResolvedValueOnce(makeOkResponse([]))                    // listRepoContents
    );
    process.env.GITHUB_TOKEN = 'valid-token';

    await doctorCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Node.js');
  });

  it('reports git as available when execSync succeeds', async () => {
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeOkResponse({ login: 'alice' }))
      .mockResolvedValueOnce(makeOkResponse([]))
    );
    process.env.GITHUB_TOKEN = 'valid-token';

    await doctorCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Git available');
  });

  it('marks git as failed when git is not in PATH', async () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('not found'); });
    saveConfig(BASE_CONFIG, testDir);

    await expect(doctorCommand()).rejects.toThrow('exit:1');

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Git available');
  });

  it('exits early and shows error when config JSON is invalid', async () => {
    writeFileSync(join(testDir, 'synap.config.json'), '{ invalid json }');

    await doctorCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('valid JSON');
  });

  it('shows caution when completion cache is missing', async () => {
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeOkResponse({ login: 'alice' }))
      .mockResolvedValueOnce(makeOkResponse([]))
    );
    process.env.GITHUB_TOKEN = 'valid-token';

    await doctorCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('cache');
  });

  it('shows valid cache entry count when cache exists and is readable', async () => {
    const cacheDir = join(homeDir, '.synap');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'completions.json'), JSON.stringify({
      '/project1': { files: ['a.md', 'b.md'], cachedAt: new Date().toISOString() },
    }));
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeOkResponse({ login: 'alice' }))
      .mockResolvedValueOnce(makeOkResponse([]))
    );
    process.env.GITHUB_TOKEN = 'valid-token';

    await doctorCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Completion cache valid');
  });

  it('marks cache as failed when cache file is corrupt JSON', async () => {
    const cacheDir = join(homeDir, '.synap');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'completions.json'), '{ corrupt }');
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeOkResponse({ login: 'alice' }))
      .mockResolvedValueOnce(makeOkResponse([]))
    );
    process.env.GITHUB_TOKEN = 'valid-token';

    await expect(doctorCommand()).rejects.toThrow('exit:1');

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Completion cache valid');
  });

  it('shows lockfile entry count when lockfile is present and valid', async () => {
    writeFileSync(join(testDir, 'synap.lock.json'), JSON.stringify({
      'acme/agents::a.md': { sha: 'sha1', ref: 'main', pulledAt: new Date().toISOString() },
    }));
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeOkResponse({ login: 'alice' }))
      .mockResolvedValueOnce(makeOkResponse([]))
    );
    process.env.GITHUB_TOKEN = 'valid-token';

    await doctorCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('synap.lock.json valid');
  });

  it('marks lockfile as failed when it contains invalid JSON', async () => {
    writeFileSync(join(testDir, 'synap.lock.json'), '{ corrupt lock }');
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeOkResponse({ login: 'alice' }))
      .mockResolvedValueOnce(makeOkResponse([]))
    );
    process.env.GITHUB_TOKEN = 'valid-token';

    await expect(doctorCommand()).rejects.toThrow('exit:1');

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('synap.lock.json valid');
  });

  it('reports no GitHub token configured when none present', async () => {
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (String(cmd).startsWith('git --version')) return 'git version 2.43.0' as unknown as Buffer;
      throw new Error('not configured');
    });
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeOkResponse([])));

    await expect(doctorCommand()).rejects.toThrow('exit:1');

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('GitHub token configured');
  });

  it('validates token and shows authenticated username when token is valid', async () => {
    process.env.GITHUB_TOKEN = 'valid-token';
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeOkResponse({ login: 'alice' }))   // validateToken → /user
      .mockResolvedValueOnce(makeOkResponse([]))                    // listRepoContents
    );

    await doctorCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('alice');
  });

  it('marks token as invalid when validation fails', async () => {
    process.env.GITHUB_TOKEN = 'bad-token';
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized', headers: makeHeaders(), json: () => Promise.resolve({}) })
      .mockResolvedValueOnce(makeOkResponse([]))
    );

    await expect(doctorCommand()).rejects.toThrow('exit:1');

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('GitHub token valid');
  });

  it('marks repo as accessible when listRepoContents succeeds', async () => {
    process.env.GITHUB_TOKEN = 'valid-token';
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeOkResponse({ login: 'alice' }))
      .mockResolvedValueOnce(makeOkResponse([]))
    );

    await doctorCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Repo accessible');
  });

  it('marks repo as not accessible when listRepoContents fails', async () => {
    process.env.GITHUB_TOKEN = 'valid-token';
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeOkResponse({ login: 'alice' }))
      .mockResolvedValueOnce(makeErrorResponse(404))
    );

    await expect(doctorCommand()).rejects.toThrow('exit:1');

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Repo accessible');
  });

  it('reports all checks passed when everything is healthy', async () => {
    process.env.GITHUB_TOKEN = 'valid-token';
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeOkResponse({ login: 'alice' }))
      .mockResolvedValueOnce(makeOkResponse([]))
    );

    await doctorCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('All checks passed');
  });

  it('marks output dir as not writable when it cannot be written', async () => {
    process.env.GITHUB_TOKEN = 'valid-token';
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeOkResponse({ login: 'alice' }))
      .mockResolvedValueOnce(makeOkResponse([]))
    );
    vi.spyOn(filesUtils, 'isDirWritable').mockReturnValueOnce(false);

    await expect(doctorCommand()).rejects.toThrow('exit:1');

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('writable');
  });

  it('exits with code 1 when any check fails', async () => {
    // No token → token check fails
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (String(cmd).startsWith('git --version')) return 'git version 2.43.0' as unknown as Buffer;
      throw new Error('no token');
    });
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeOkResponse([])));

    await expect(doctorCommand()).rejects.toThrow('exit:1');
  });

  it('marks output directory as not writable when isDirWritable returns false', async () => {
    process.env.GITHUB_TOKEN = 'valid-token';
    saveConfig(BASE_CONFIG, testDir);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeOkResponse({ login: 'alice' }))
      .mockResolvedValueOnce(makeOkResponse([]))
    );
    vi.spyOn(filesUtils, 'isDirWritable').mockReturnValueOnce(false);

    await expect(doctorCommand()).rejects.toThrow('exit:1');

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Output dir writable');
  });
});
