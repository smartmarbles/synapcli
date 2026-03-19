import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('@clack/prompts', () => ({
  confirm:  vi.fn().mockResolvedValue(true),
  isCancel: vi.fn(() => false),
  cancel:   vi.fn(),
}));

import { deleteCommand }                  from '../../commands/delete.js';
import { saveConfig, saveLock, loadLock } from '../../lib/config.js';
import { setCI }                          from '../../utils/context.js';
import type { SynapConfig }               from '../../types.js';

const OWNER    = 'acme';
const REPO     = 'agents';
const REPO_KEY = `${OWNER}/${REPO}`;
const BRANCH   = 'main';

const LOCK_ENTRY = { sha: 'sha-v1', ref: BRANCH, pulledAt: new Date().toISOString() };

let testDir: string;

const BASE_CONFIG: SynapConfig = {
  repo: `${OWNER}/${REPO}`, branch: BRANCH, remotePath: '', localOutput: '.',
};

beforeEach(() => {
  testDir = join(tmpdir(), `synap-delete-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(testDir);
  vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  saveConfig(BASE_CONFIG, testDir);
});

afterEach(() => {
  setCI(false);
  rmSync(testDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('deleteCommand', () => {

  it('deletes tracked files from disk and removes lock entries', async () => {
    writeFileSync(join(testDir, 'summarizer.md'), '# Summarizer');
    writeFileSync(join(testDir, 'classifier.md'), '# Classifier');
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { ...LOCK_ENTRY },
      [`${REPO_KEY}::classifier.md`]: { ...LOCK_ENTRY },
    }, testDir);

    await deleteCommand(undefined, { force: true });

    expect(existsSync(join(testDir, 'summarizer.md'))).toBe(false);
    expect(existsSync(join(testDir, 'classifier.md'))).toBe(false);
    const lock = loadLock(testDir);
    expect(lock[`${REPO_KEY}::summarizer.md`]).toBeUndefined();
    expect(lock[`${REPO_KEY}::classifier.md`]).toBeUndefined();
  });

  it('--dry-run shows files without deleting them', async () => {
    writeFileSync(join(testDir, 'summarizer.md'), '# Summarizer');
    saveLock({ [`${REPO_KEY}::summarizer.md`]: { ...LOCK_ENTRY } }, testDir);

    await deleteCommand(undefined, { dryRun: true });

    expect(existsSync(join(testDir, 'summarizer.md'))).toBe(true);
    const lock = loadLock(testDir);
    expect(lock[`${REPO_KEY}::summarizer.md`]).toBeDefined();
  });

  it('name filter only deletes matching files', async () => {
    writeFileSync(join(testDir, 'summarizer.md'), '# Summarizer');
    writeFileSync(join(testDir, 'classifier.md'), '# Classifier');
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { ...LOCK_ENTRY },
      [`${REPO_KEY}::classifier.md`]: { ...LOCK_ENTRY },
    }, testDir);

    await deleteCommand('summarizer', { force: true });

    expect(existsSync(join(testDir, 'summarizer.md'))).toBe(false);
    expect(existsSync(join(testDir, 'classifier.md'))).toBe(true);
    const lock = loadLock(testDir);
    expect(lock[`${REPO_KEY}::summarizer.md`]).toBeUndefined();
    expect(lock[`${REPO_KEY}::classifier.md`]).toBeDefined();
  });

  it('cleans lock entry for an already-absent file without error', async () => {
    // File not on disk but has a lock entry (manually deleted)
    saveLock({ [`${REPO_KEY}::summarizer.md`]: { ...LOCK_ENTRY } }, testDir);

    await deleteCommand(undefined, { force: true });

    expect(existsSync(join(testDir, 'summarizer.md'))).toBe(false);
    const lock = loadLock(testDir);
    expect(lock[`${REPO_KEY}::summarizer.md`]).toBeUndefined();
  });

  it('handles mixed present and absent tracked files', async () => {
    writeFileSync(join(testDir, 'summarizer.md'), '# Summarizer');
    // classifier not on disk but in lock
    saveLock({
      [`${REPO_KEY}::summarizer.md`]: { ...LOCK_ENTRY },
      [`${REPO_KEY}::classifier.md`]: { ...LOCK_ENTRY },
    }, testDir);

    await deleteCommand(undefined, { force: true });

    expect(existsSync(join(testDir, 'summarizer.md'))).toBe(false);
    const lock = loadLock(testDir);
    expect(lock[`${REPO_KEY}::summarizer.md`]).toBeUndefined();
    expect(lock[`${REPO_KEY}::classifier.md`]).toBeUndefined();
  });

  it('--failed__ lock entries are not treated as tracked files', async () => {
    saveLock({
      [`${REPO_KEY}::__failed__`]: ['summarizer.md'] as unknown,
    } as never, testDir);

    // No real files to delete — should warn and return cleanly
    await deleteCommand(undefined, { force: true });

    // Lock should be unchanged since __failed__ is not a tracked file
    const lock = loadLock(testDir);
    expect(lock[`${REPO_KEY}::__failed__`]).toBeDefined();
  });

  it('CI mode with --force deletes files without prompting', async () => {
    writeFileSync(join(testDir, 'summarizer.md'), '# Summarizer');
    saveLock({ [`${REPO_KEY}::summarizer.md`]: { ...LOCK_ENTRY } }, testDir);
    setCI(true);

    await deleteCommand(undefined, { force: true });

    expect(existsSync(join(testDir, 'summarizer.md'))).toBe(false);
  });

  it('CI mode without --force exits with conflict error', async () => {
    writeFileSync(join(testDir, 'summarizer.md'), '# Summarizer');
    saveLock({ [`${REPO_KEY}::summarizer.md`]: { ...LOCK_ENTRY } }, testDir);
    setCI(true);

    await expect(deleteCommand(undefined, { force: false })).rejects.toThrow('exit:5');
  });

  it('exits with code 2 when config file is missing', async () => {
    rmSync(join(testDir, 'synap.config.json'));
    await expect(deleteCommand(undefined, {})).rejects.toThrow('exit:2');
  });
});
