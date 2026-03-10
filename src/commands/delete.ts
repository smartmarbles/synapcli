import chalk from 'chalk';
import * as p from '@clack/prompts';
import { loadConfig, parseRepoString, loadLock, saveLock } from '../lib/config.js';
import { deleteFile, fileExists, resolveLocalPath } from '../utils/files.js';
import { log, fatal } from '../utils/logger.js';
import type { DeleteOptions, LockFile } from '../types.js';

export async function deleteCommand(
  name: string | undefined,
  options: DeleteOptions
): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal((err as Error).message);
  }

  const { owner, repo } = parseRepoString(config.repo);
  const remotePath = config.remotePath || '';
  const lock = loadLock();

  const trackedPaths = Object.keys(lock);

  if (trackedPaths.length === 0) {
    log.warn('No files are tracked in synap.lock.json. Nothing to delete.');
    return;
  }

  // Filter to files matching the name arg, if provided
  const targets = name
    ? trackedPaths.filter((p) => p.includes(name))
    : trackedPaths;

  if (targets.length === 0) {
    log.warn(`No tracked files matched "${name}".`);
    log.dim(`Run ${chalk.white('synap list')} to see available files.`);
    return;
  }

  // Resolve local paths and check which ones actually exist on disk
  const resolved = targets.map((remotePath_) => {
    const localPath = resolveLocalPath({
      remotePath: remotePath_,
      remoteBase: remotePath,
      localOutput: config.localOutput,
    });
    return { remotePath: remotePath_, localPath, exists: fileExists(localPath) };
  });

  const present = resolved.filter((f) => f.exists);
  const missing = resolved.filter((f) => !f.exists);

  if (missing.length > 0 && !options.dryRun) {
    log.dim(`\n${missing.length} tracked file(s) already absent from disk (lock entries will still be removed):`);
    for (const f of missing) {
      console.log(`  ${chalk.dim('–')} ${chalk.dim(f.localPath)}`);
    }
  }

  if (options.dryRun) {
    log.title('Dry run — files that would be deleted:');
    console.log();
    for (const f of resolved) {
      const status = f.exists ? chalk.red('delete') : chalk.dim('already gone');
      log.dryRun(`${chalk.white(f.localPath)} ${chalk.dim(`(${status})`)}`);
    }
    console.log();
    log.dim('No files deleted. Remove --dry-run to apply.');
    return;
  }

  if (present.length === 0) {
    log.warn('All matched files are already absent from disk. Cleaning lock entries…');
    cleanLock(lock, targets);
    saveLock(lock);
    log.success(`Removed ${targets.length} entr${targets.length === 1 ? 'y' : 'ies'} from synap.lock.json`);
    return;
  }

  // Preview what will be deleted
  log.title(`${present.length} file(s) will be deleted:`);
  console.log();
  for (const f of present) {
    console.log(`  ${chalk.red('✖')} ${chalk.white(f.localPath)}`);
  }
  console.log();

  if (!options.force) {
    const confirmed = await p.confirm({
      message: `Delete ${present.length} file(s) and remove from lock?`,
      initialValue: false,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Delete cancelled.');
      process.exit(0);
    }
  }

  const results = { deleted: [] as string[], failed: [] as string[] };

  for (const file of present) {
    try {
      deleteFile(file.localPath);
      results.deleted.push(file.localPath);
      log.success(`Deleted ${chalk.white(file.localPath)}`);
    } catch (err) {
      log.error(`Failed to delete ${file.localPath}: ${(err as Error).message}`);
      results.failed.push(file.localPath);
    }
  }

  // Remove all matched entries from the lock (even ones not on disk)
  cleanLock(lock, targets);
  saveLock(lock);

  console.log();
  if (results.deleted.length) log.success(`${results.deleted.length} file(s) deleted`);
  if (missing.length)         log.dim(`${missing.length} lock entr${missing.length === 1 ? 'y' : 'ies'} cleaned (files were already absent)`);
  if (results.failed.length)  log.error(`${results.failed.length} file(s) failed to delete`);
  log.dim(`\nRun ${chalk.white(`synap pull`)} to restore, or ${chalk.white('synap list')} to browse.`);
}

function cleanLock(lock: LockFile, paths: string[]): void {
  for (const p of paths) {
    delete lock[p];
  }
}
