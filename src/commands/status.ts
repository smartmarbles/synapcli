import ora from 'ora';
import chalk from 'chalk';
import {
  loadConfig, parseRepoString, loadLock,
  resolvedSources, lockKey,
} from '../lib/config.js';
import { fetchAllFiles } from '../lib/github.js';
import { filterFiles } from '../lib/filter.js';
import { fileExists, resolveLocalPath } from '../utils/files.js';
import { log, fatal } from '../utils/logger.js';
import { ExitCode } from '../types.js';
import type { StatusEntry, FileStatus } from '../types.js';

export async function statusCommand(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal((err as Error).message, ExitCode.ConfigError);
  }

  const sources = resolvedSources(config);
  const lock = loadLock();
  const allEntries: StatusEntry[] = [];

  for (const source of sources) {
    const { owner, repo } = parseRepoString(source.repo);
    /* v8 ignore start */
    const ref = source.branch || 'main';
    const remotePath = source.remotePath || '';
    const repoKey = `${owner}/${repo}`;
    /* v8 ignore stop */

    /* v8 ignore start */
    const spinner = ora(`Fetching remote state from ${chalk.cyan(source.name ?? repoKey)}…`).start();
    /* v8 ignore stop */
    let allFiles;
    try {
      allFiles = await fetchAllFiles({ owner, repo, path: remotePath, ref });
      spinner.stop();
    } catch (err) {
      /* v8 ignore start */
      spinner.fail(`Failed to fetch from ${source.name ?? repoKey}`);
      /* v8 ignore stop */
      fatal((err as Error).message, ExitCode.NetworkError);
    }

    const files = filterFiles(allFiles, source);

    for (const file of files) {
      const localPath = resolveLocalPath({
        remotePath: file.path,
        remoteBase: remotePath,
        localOutput: source.localOutput,
      });
      const key = lockKey(repoKey, file.path);
      const entry = lock[key];

      let status: FileStatus;
      if (!entry) {
        status = 'not-pulled';
      } else if (!fileExists(localPath)) {
        status = 'missing-locally';
      } else if (entry.sha !== file.sha) {
        status = 'changed';
      } else {
        status = 'up-to-date';
      }

      allEntries.push({ remotePath: file.path, localPath, status, source });
    }
  }

  if (allEntries.length === 0) {
    log.warn('No files found across all configured sources.');
    return;
  }

  // Group by status
  const groups: Record<FileStatus, StatusEntry[]> = {
    'changed':        allEntries.filter((e) => e.status === 'changed'),
    'missing-locally': allEntries.filter((e) => e.status === 'missing-locally'),
    'not-pulled':     allEntries.filter((e) => e.status === 'not-pulled'),
    'up-to-date':     allEntries.filter((e) => e.status === 'up-to-date'),
  };

  console.log();

  if (groups.changed.length > 0) {
    console.log(chalk.bold.yellow(`  Changed upstream (${groups.changed.length}):`));
    for (const e of groups.changed) {
      console.log(`    ${chalk.yellow('~')} ${chalk.white(e.remotePath)}`);
    }
    console.log();
  }

  if (groups['missing-locally'].length > 0) {
    console.log(chalk.bold.red(`  Missing locally (${groups['missing-locally'].length}):`));
    for (const e of groups['missing-locally']) {
      console.log(`    ${chalk.red('✖')} ${chalk.white(e.remotePath)}`);
    }
    console.log();
  }

  if (groups['not-pulled'].length > 0) {
    console.log(chalk.bold.cyan(`  Not yet pulled (${groups['not-pulled'].length}):`));
    for (const e of groups['not-pulled']) {
      console.log(`    ${chalk.cyan('+')} ${chalk.white(e.remotePath)}`);
    }
    console.log();
  }

  if (groups['up-to-date'].length > 0) {
    console.log(chalk.bold.green(`  Up to date (${groups['up-to-date'].length}):`));
    for (const e of groups['up-to-date']) {
      console.log(`    ${chalk.green('✔')} ${chalk.dim(e.remotePath)}`);
    }
    console.log();
  }

  // Summary line
  const changed  = groups.changed.length + groups['missing-locally'].length;
  const pending  = groups['not-pulled'].length;

  if (changed > 0) {
    log.info(`${changed} file(s) need attention. Run ${chalk.white('synap update')} to sync.`);
  } else if (pending > 0) {
    log.info(`${pending} file(s) not yet pulled. Run ${chalk.white('synap pull')} to download.`);
  } else {
    log.success('Everything is up to date.');
  }
}
