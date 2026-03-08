import ora from 'ora';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import { loadConfig, parseRepoString, loadLock, saveLock } from '../lib/config.js';
import { fetchAllFiles, fetchFileContent } from '../lib/github.js';
import { writeFile, resolveLocalPath } from '../utils/files.js';
import { log, fatal } from '../utils/logger.js';

export async function updateCommand(name, options) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal(err.message);
  }

  const { owner, repo } = parseRepoString(config.repo);
  const ref = config.branch || 'main';
  const remotePath = config.remotePath || '';
  const lock = loadLock();

  const spinner = ora('Checking for upstream changes…').start();
  let allFiles;
  try {
    allFiles = await fetchAllFiles({ owner, repo, path: remotePath, ref });
    spinner.succeed(`Scanned ${chalk.bold(allFiles.length)} remote file(s)`);
  } catch (err) {
    spinner.fail('Failed to fetch file list');
    fatal(err.message);
  }

  const targets = name
    ? allFiles.filter((f) => f.path.includes(name))
    : allFiles;

  // Identify files whose SHA has changed since last pull
  const changed = targets.filter((f) => {
    const entry = lock[f.path];
    return !entry || entry.sha !== f.sha;
  });

  if (changed.length === 0) {
    log.success('Everything is up to date. Nothing to update.');
    return;
  }

  log.title(`${changed.length} file(s) have upstream changes:`);
  console.log();
  for (const f of changed) {
    const wasNew = !lock[f.path];
    console.log(`  ${chalk.green('•')} ${chalk.white(f.path)} ${wasNew ? chalk.dim('(new)') : chalk.yellow('(changed)')}`);
  }
  console.log();

  if (!options.force) {
    const confirm = await p.confirm({
      message: `Update ${changed.length} file(s)?`,
      initialValue: true,
    });

    if (p.isCancel(confirm) || !confirm) {
      p.cancel('Update cancelled.');
      process.exit(0);
    }
  }

  const results = { written: [], failed: [] };

  for (const file of changed) {
    const localPath = resolveLocalPath({
      remotePath: file.path,
      remoteBase: remotePath,
      localOutput: config.localOutput,
    });

    const fileSpinner = ora(`Updating ${chalk.cyan(file.path)}`).start();
    try {
      const { content, sha } = await fetchFileContent({
        owner,
        repo,
        path: file.path,
        ref,
      });

      writeFile(localPath, content);
      lock[file.path] = { sha, ref, pulledAt: new Date().toISOString() };
      fileSpinner.succeed(`${chalk.white(file.path)} → ${chalk.dim(localPath)}`);
      results.written.push(file.path);
    } catch (err) {
      fileSpinner.fail(`Failed: ${file.path}`);
      log.error(err.message);
      results.failed.push(file.path);
    }
  }

  saveLock(lock);

  console.log();
  if (results.written.length) log.success(`${results.written.length} file(s) updated`);
  if (results.failed.length) log.error(`${results.failed.length} file(s) failed`);
}
