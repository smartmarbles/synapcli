import chalk from 'chalk';
import * as p from '@clack/prompts';
import {
  loadConfig, parseRepoString, loadLock, saveLock,
  resolvedSources, lockKey,
} from '../lib/config.js';
import { deleteFile, fileExists, resolveLocalPath } from '../utils/files.js';
import { log, fatal } from '../utils/logger.js';
import { isCI } from '../utils/context.js';
import { ExitCode } from '../types.js';
import type { DeleteOptions } from '../types.js';

export async function deleteCommand(
  name: string | undefined,
  options: DeleteOptions
): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal((err as Error).message, ExitCode.ConfigError);
  }

  const sources = resolvedSources(config);
  const lock = loadLock();
  let totalDeleted = 0;
  let totalFailed = 0;

  for (const source of sources) {
    const { owner, repo } = parseRepoString(source.repo);
    /* v8 ignore start */
    const remotePath = source.remotePath || '';
    const label = source.name ?? source.repo;
    const repoKey = `${owner}/${repo}`;
    /* v8 ignore stop */

    // Collect tracked paths for this source
    const prefix = `${repoKey}::`;
    /* v8 ignore start */
    const trackedKeys = Object.keys(lock).filter((k) => k.startsWith(prefix) && !k.endsWith('::__failed__'));
    /* v8 ignore stop */
    const trackedPaths = trackedKeys.map((k) => k.slice(prefix.length));

    const targets = name
      ? trackedPaths.filter((p) => p.includes(name))
      : trackedPaths;

    if (targets.length === 0) {
      /* v8 ignore start */
      log.warn(`No tracked files matched in ${label}${name ? ` for "${name}"` : ''}.`);
      /* v8 ignore stop */
      continue;
    }

    const resolved = targets.map((filePath) => ({
      remotePath: filePath,
      localPath: resolveLocalPath({ remotePath: filePath, remoteBase: remotePath, localOutput: source.localOutput }),
      lockKey: lockKey(repoKey, filePath),
    }));

    const present = resolved.filter((f) => fileExists(f.localPath));
    const missing = resolved.filter((f) => !fileExists(f.localPath));

    if (options.dryRun) {
      log.title(`[${label}] Dry run — files that would be deleted:`);
      console.log();
      for (const f of resolved) {
        /* v8 ignore start */
        const status = fileExists(f.localPath) ? chalk.red('delete') : chalk.dim('already gone');
        /* v8 ignore stop */
        log.dryRun(`${chalk.white(f.localPath)} ${chalk.dim(`(${status})`)}`);
      }
      console.log();
      continue;
    }

    if (present.length === 0) {
      log.warn(`[${label}] All matched files already absent. Cleaning lock entries…`);
      for (const f of resolved) delete lock[f.lockKey];
      saveLock(lock);
      /* v8 ignore start */
      log.success(`Removed ${resolved.length} lock entr${resolved.length === 1 ? 'y' : 'ies'}`);
      /* v8 ignore stop */
      continue;
    }

    log.title(`[${label}] ${present.length} file(s) will be deleted:`);
    console.log();
    for (const f of present) {
      console.log(`  ${chalk.red('✖')} ${chalk.white(f.localPath)}`);
    }
    console.log();

    if (!options.force && !isCI()) {
      const confirmed = await p.confirm({
        message: `Delete ${present.length} file(s) and remove from lock?`,
        initialValue: false,
      });
      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel('Delete cancelled.');
        process.exit(0);
      }
    } else if (isCI() && !options.force) {
      fatal(`Delete requires --force in CI mode.`, ExitCode.ConflictError);
    }

    for (const file of present) {
      try {
        deleteFile(file.localPath);
        delete lock[file.lockKey];
        log.success(`Deleted ${chalk.white(file.localPath)}`);
        totalDeleted++;
      } catch (err) {
        log.error(`Failed to delete ${file.localPath}: ${(err as Error).message}`);
        totalFailed++;
      }
    }

    // Clean missing entries from lock too
    for (const f of missing) delete lock[f.lockKey];
    saveLock(lock);

    if (missing.length) {
      /* v8 ignore start */
      log.dim(`${missing.length} lock entr${missing.length === 1 ? 'y' : 'ies'} cleaned (files were already absent)`);
      /* v8 ignore stop */
    }
  }

  console.log();
  if (totalDeleted) log.success(`${totalDeleted} file(s) deleted`);
  if (totalFailed) {
    fatal(`${totalFailed} file(s) failed to delete`, ExitCode.GeneralError);
  }

  log.dim(`\nRun ${chalk.white('synap pull')} to restore, or ${chalk.white('synap list')} to browse.`);
}
