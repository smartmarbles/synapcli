import ora from 'ora';
import chalk from 'chalk';
import { loadConfig, parseRepoString } from '../lib/config.js';
import { fetchAllFiles } from '../lib/github.js';
import { log, fatal } from '../utils/logger.js';

export async function listCommand(options) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal(err.message);
  }

  const { owner, repo } = parseRepoString(config.repo);
  const ref = config.branch || 'main';
  const remotePath = config.remotePath || '';

  const spinner = ora(`Fetching file list from ${chalk.cyan(`${owner}/${repo}`)}`).start();

  let files;
  try {
    files = await fetchAllFiles({ owner, repo, path: remotePath, ref });
    spinner.succeed(`Found ${chalk.bold(files.length)} file(s)`);
  } catch (err) {
    spinner.fail('Failed to fetch file list');
    fatal(err.message);
  }

  if (options.json) {
    console.log(JSON.stringify(files, null, 2));
    return;
  }

  if (files.length === 0) {
    log.warn('No files found at the configured path.');
    return;
  }

  log.title(`Files in ${owner}/${repo} @ ${ref}${remotePath ? ` / ${remotePath}` : ''}`);
  console.log();

  for (const file of files) {
    const label = file.path.replace(remotePath ? remotePath + '/' : '', '');
    const size = formatSize(file.size);
    console.log(`  ${chalk.green('•')} ${chalk.white(label)} ${chalk.dim(size)}`);
  }

  console.log();
  log.dim(`Tip: Run ${chalk.white('synap pull <name>')} to fetch a specific file, or ${chalk.white('synap pull')} for all.`);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
