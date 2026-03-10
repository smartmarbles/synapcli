import ora from 'ora';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import { loadConfig, parseRepoString, loadLock, saveLock } from '../lib/config.js';
import { fetchAllFiles, fetchFileContent } from '../lib/github.js';
import { writeFile, readLocalFile, resolveLocalPath } from '../utils/files.js';
import { log, fatal } from '../utils/logger.js';
import type { PullOptions } from '../types.js';

export async function pullCommand(
  name: string | undefined,
  options: PullOptions
): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal((err as Error).message);
  }

  const { owner, repo } = parseRepoString(config.repo);
  const ref = options.branch ?? config.branch ?? 'main';
  const remotePath = config.remotePath || '';

  // 1. Discover files
  const spinner = ora('Fetching file list…').start();
  let allFiles;
  try {
    allFiles = await fetchAllFiles({ owner, repo, path: remotePath, ref });
    spinner.succeed(`Found ${chalk.bold(allFiles.length)} file(s)`);
  } catch (err) {
    spinner.fail('Failed to fetch file list');
    fatal((err as Error).message);
  }

  // 2. Filter by name if provided
  const targets = name ? allFiles.filter((f) => f.path.includes(name)) : allFiles;

  if (targets.length === 0) {
    log.warn(name ? `No files matched "${name}"` : 'No files found at the configured path.');
    process.exit(0);
  }

  if (options.dryRun) {
    log.title('Dry run — files that would be downloaded:');
    console.log();
    for (const file of targets) {
      const localPath = resolveLocalPath({
        remotePath: file.path,
        remoteBase: remotePath,
        localOutput: config.localOutput,
      });
      log.dryRun(`${chalk.white(file.path)} → ${chalk.dim(localPath)}`);
    }
    console.log();
    log.dim('No files written. Remove --dry-run to apply.');
    return;
  }

  // 3. Load lock file to detect conflicts
  const lock = loadLock();
  const results = { written: [] as string[], skipped: [] as string[], failed: [] as string[] };

  for (const file of targets) {
    const localPath = resolveLocalPath({
      remotePath: file.path,
      remoteBase: remotePath,
      localOutput: config.localOutput,
    });

    const existing = readLocalFile(localPath);
    const alreadyLocked = lock[file.path];

    // Conflict: file exists locally and wasn't put there by synap
    if (existing !== null && !alreadyLocked && !options.force) {
      const choice = await p.select({
        message: `${chalk.yellow(localPath)} exists and wasn't pulled by SynapCLI. Overwrite?`,
        options: [
          { value: 'overwrite', label: 'Overwrite' },
          { value: 'skip',      label: 'Skip' },
        ],
      });

      if (p.isCancel(choice) || choice === 'skip') {
        results.skipped.push(file.path);
        continue;
      }
    }

    const fileSpinner = ora(`Pulling ${chalk.cyan(file.path)}`).start();
    try {
      const { content, sha } = await fetchFileContent({ owner, repo, path: file.path, ref });
      writeFile(localPath, content);
      lock[file.path] = { sha, ref, pulledAt: new Date().toISOString() };
      fileSpinner.succeed(`${chalk.white(file.path)} → ${chalk.dim(localPath)}`);
      results.written.push(file.path);
    } catch (err) {
      fileSpinner.fail(`Failed: ${file.path}`);
      log.error((err as Error).message);
      results.failed.push(file.path);
    }
  }

  saveLock(lock);

  console.log();
  if (results.written.length)  log.success(`${results.written.length} file(s) written`);
  if (results.skipped.length)  log.warn(`${results.skipped.length} file(s) skipped`);
  if (results.failed.length)   log.error(`${results.failed.length} file(s) failed`);
}
