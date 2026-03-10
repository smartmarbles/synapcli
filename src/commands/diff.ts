import ora from 'ora';
import chalk from 'chalk';
import { createPatch } from 'diff';
import { loadConfig, parseRepoString, loadLock } from '../lib/config.js';
import { fetchAllFiles, fetchFileContent } from '../lib/github.js';
import { readLocalFile, resolveLocalPath } from '../utils/files.js';
import { log, fatal } from '../utils/logger.js';

export async function diffCommand(name: string | undefined): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal((err as Error).message);
  }

  const { owner, repo } = parseRepoString(config.repo);
  const ref = config.branch || 'main';
  const remotePath = config.remotePath || '';
  const lock = loadLock();

  const spinner = ora('Fetching remote file list…').start();
  let allFiles;
  try {
    allFiles = await fetchAllFiles({ owner, repo, path: remotePath, ref });
    spinner.succeed('File list ready');
  } catch (err) {
    spinner.fail('Failed to fetch file list');
    fatal((err as Error).message);
  }

  const targets = name ? allFiles.filter((f) => f.path.includes(name)) : allFiles;

  let changedCount = 0;

  for (const file of targets) {
    const localPath = resolveLocalPath({
      remotePath: file.path,
      remoteBase: remotePath,
      localOutput: config.localOutput,
    });

    const localContent = readLocalFile(localPath);
    const lockedEntry = lock[file.path];

    // If SHA matches what we locked, skip fetching (no change)
    if (lockedEntry && lockedEntry.sha === file.sha) continue;

    const fetching = ora(`Checking ${chalk.cyan(file.path)}…`).start();
    let remoteContent: string;
    try {
      const result = await fetchFileContent({ owner, repo, path: file.path, ref });
      remoteContent = result.content;
      fetching.stop();
    } catch {
      fetching.fail(`Could not fetch ${file.path}`);
      continue;
    }

    if (localContent === null) {
      log.warn(`${chalk.white(file.path)} — ${chalk.yellow('new file (not pulled yet)')}`);
      changedCount++;
      continue;
    }

    if (localContent === remoteContent) continue;

    changedCount++;
    console.log();
    console.log(chalk.bold.white(`--- ${localPath} (local)`));
    console.log(chalk.bold.white(`+++ ${file.path} (remote @ ${ref})`));
    console.log();

    const patch = createPatch(file.path, localContent, remoteContent, 'local', `remote@${ref}`);
    const lines = patch.split('\n').slice(4); // strip file header lines

    for (const line of lines) {
      if (line.startsWith('+'))       process.stdout.write(chalk.green(line) + '\n');
      else if (line.startsWith('-'))  process.stdout.write(chalk.red(line) + '\n');
      else if (line.startsWith('@@')) process.stdout.write(chalk.cyan(line) + '\n');
      else                            process.stdout.write(chalk.dim(line) + '\n');
    }
  }

  console.log();
  if (changedCount === 0) {
    log.success('All local files are up to date.');
  } else {
    log.info(`${changedCount} file(s) differ. Run ${chalk.white('synap update')} to sync.`);
  }
}
