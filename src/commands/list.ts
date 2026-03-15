import ora from 'ora';
import chalk from 'chalk';
import { loadConfig, parseRepoString, resolvedSources } from '../lib/config.js';
import { fetchAllFiles } from '../lib/github.js';
import { filterFiles } from '../lib/filter.js';
import { log, fatal } from '../utils/logger.js';
import { ExitCode } from '../types.js';
import type { ListOptions, RemoteFile } from '../types.js';

export async function listCommand(options: ListOptions): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal((err as Error).message, ExitCode.ConfigError);
  }

  const sources = resolvedSources(config);
  const allResults: { sourceName: string; files: RemoteFile[] }[] = [];

  for (const source of sources) {
    const { owner, repo } = parseRepoString(source.repo);
    const ref = source.branch || 'main';
    const remotePath = source.remotePath || '';
    const label = source.name ?? source.repo;

    const spinner = ora(`Fetching file list from ${chalk.cyan(label)}`).start();

    try {
      const raw = await fetchAllFiles({ owner, repo, path: remotePath, ref });
      const files = filterFiles(raw, source);
      spinner.succeed(`${chalk.cyan(label)} — ${chalk.bold(files.length)} file(s)`);
      allResults.push({ sourceName: label, files });
    } catch (err) {
      spinner.fail(`Failed to fetch from ${label}`);
      fatal((err as Error).message, ExitCode.NetworkError);
    }
  }

  if (options.json) {
    console.log(JSON.stringify(allResults, null, 2));
    return;
  }

  for (const { sourceName, files } of allResults) {
    if (files.length === 0) {
      log.warn(`No files found in ${sourceName}.`);
      continue;
    }

    log.title(`${sourceName}`);
    console.log();

    for (const file of files) {
      const remotePath = sources.find((s) => s.name === sourceName || s.repo === sourceName)?.remotePath ?? '';
      const label = file.path.replace(remotePath ? remotePath + '/' : '', '');
      console.log(`  ${chalk.green('•')} ${chalk.white(label)} ${chalk.dim(formatSize(file.size))}`);
    }

    console.log();
  }

  log.dim(`Tip: Run ${chalk.white('synap pull')} to download all files, or ${chalk.white('synap pull <n>')} for a specific one.`);
}

function formatSize(bytes: number): string {
  if (bytes < 1024)            return `${bytes}B`;
  if (bytes < 1024 * 1024)     return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
