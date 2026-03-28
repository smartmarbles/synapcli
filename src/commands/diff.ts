import ora from 'ora';
import chalk from 'chalk';
import { createPatch } from 'diff';
import { loadConfig, parseRepoString, loadLock, resolvedSources, lockKey } from '../lib/config.js';
import { fetchAllFiles, fetchFileContent } from '../lib/github.js';
import { filterFiles } from '../lib/filter.js';
import { readLocalFile, resolveLocalPath } from '../utils/files.js';
import { log, fatal } from '../utils/logger.js';
import { ExitCode } from '../types.js';

export async function diffCommand(name: string | undefined): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal((err as Error).message, ExitCode.ConfigError);
  }

  const sources = resolvedSources(config);
  const lock = loadLock();
  let totalChanged = 0;

  for (const source of sources) {
    const { owner, repo } = parseRepoString(source.repo);
    /* v8 ignore next */
    const ref = source.branch || 'main';
    /* v8 ignore next */
    const remotePath = source.remotePath || '';
    /* v8 ignore next */
    const label = source.name ?? source.repo;

    const spinner = ora(`[${chalk.cyan(label)}] Fetching file list…`).start();
    let allFiles;
    try {
      allFiles = await fetchAllFiles({ owner, repo, path: remotePath, ref });
      spinner.succeed(`[${chalk.cyan(label)}] File list ready`);
    } catch (err) {
      spinner.fail(`Failed to fetch from ${label}`);
      fatal((err as Error).message, ExitCode.NetworkError);
    }

    let targets = filterFiles(allFiles, source);
    if (name) targets = targets.filter((f) => f.path.includes(name));

    for (const file of targets) {
      const localPath = resolveLocalPath({ remotePath: file.path, remoteBase: remotePath, localOutput: source.localOutput });
      const key = lockKey(`${owner}/${repo}`, file.path);
      const lockedEntry = lock[key];

      // SHA unchanged — skip fetching content
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

      const localContent = readLocalFile(localPath);

      if (localContent === null) {
        log.warn(`${chalk.white(file.path)} — ${chalk.yellow('new file (not pulled yet)')}`);
        totalChanged++;
        continue;
      }

      if (localContent === remoteContent) continue;

      totalChanged++;
      console.log();
      console.log(chalk.bold.white(`--- ${localPath} (local)`));
      console.log(chalk.bold.white(`+++ ${file.path} (remote @ ${ref})`));
      console.log();

      const patch = createPatch(file.path, localContent, remoteContent, 'local', `remote@${ref}`);
      const lines = patch.split('\n').slice(4);

      for (const line of lines) {
        if (line.startsWith('+'))       process.stdout.write(chalk.green(line) + '\n');
        else if (line.startsWith('-'))  process.stdout.write(chalk.red(line) + '\n');
        else if (line.startsWith('@@')) process.stdout.write(chalk.cyan(line) + '\n');
        else                            process.stdout.write(chalk.dim(line) + '\n');
      }
    }
  }

  console.log();
  if (totalChanged === 0) {
    log.success('All local files are up to date.');
  } else {
    log.info(`${totalChanged} file(s) differ. Run ${chalk.white('synap update')} to sync.`);
  }
}
