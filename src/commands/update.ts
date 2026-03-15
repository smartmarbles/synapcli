import ora from 'ora';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import {
  loadConfig, parseRepoString, loadLock, saveLock,
  resolvedSources, lockKey,
} from '../lib/config.js';
import { fetchAllFiles, fetchFileContent } from '../lib/github.js';
import { filterFiles } from '../lib/filter.js';
import { runPostPullHook } from '../lib/hooks.js';
import { writeFile, resolveLocalPath } from '../utils/files.js';
import { log, fatal } from '../utils/logger.js';
import { SynapProgress } from '../utils/progress.js';
import { isCI } from '../utils/context.js';
import { ExitCode } from '../types.js';
import type { UpdateOptions } from '../types.js';

export async function updateCommand(
  name: string | undefined,
  options: UpdateOptions
): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal((err as Error).message, ExitCode.ConfigError);
  }

  const sources = resolvedSources(config);
  const lock = loadLock();
  let totalWritten = 0;
  let totalFailed = 0;

  for (const source of sources) {
    const { owner, repo } = parseRepoString(source.repo);
    const ref = source.branch || 'main';
    const remotePath = source.remotePath || '';
    const label = source.name ?? source.repo;

    const spinner = ora(`[${chalk.cyan(label)}] Checking for upstream changes…`).start();
    let allFiles;
    try {
      allFiles = await fetchAllFiles({ owner, repo, path: remotePath, ref });
      spinner.succeed(`[${chalk.cyan(label)}] Scanned ${chalk.bold(allFiles.length)} remote file(s)`);
    } catch (err) {
      spinner.fail(`Failed to fetch from ${label}`);
      fatal((err as Error).message, ExitCode.NetworkError);
    }

    let targets = filterFiles(allFiles, source);
    if (name) targets = targets.filter((f) => f.path.includes(name));

    // Only files whose SHA has changed
    const changed = targets.filter((f) => {
      const entry = lock[lockKey(`${owner}/${repo}`, f.path)];
      return !entry || entry.sha !== f.sha;
    });

    if (changed.length === 0) {
      log.success(`[${label}] All files up to date.`);
      continue;
    }

    log.title(`[${label}] ${changed.length} file(s) with upstream changes:`);
    console.log();
    for (const f of changed) {
      const wasNew = !lock[lockKey(`${owner}/${repo}`, f.path)];
      console.log(
        `  ${chalk.green('•')} ${chalk.white(f.path)} ` +
        `${wasNew ? chalk.dim('(new)') : chalk.yellow('(changed)')}`
      );
    }
    console.log();

    if (!options.force && !isCI()) {
      const confirmed = await p.confirm({
        message: `Update ${changed.length} file(s) from ${label}?`,
        initialValue: true,
      });
      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel('Update cancelled.');
        process.exit(0);
      }
    }

    const progress = new SynapProgress(changed.length, 'files');
    const results = { written: [] as string[], failed: [] as string[] };

    for (const file of changed) {
      const localPath = resolveLocalPath({ remotePath: file.path, remoteBase: remotePath, localOutput: source.localOutput });

      try {
        const { content, sha } = await fetchFileContent({ owner, repo, path: file.path, ref });
        writeFile(localPath, content);
        lock[lockKey(`${owner}/${repo}`, file.path)] = { sha, ref, pulledAt: new Date().toISOString() };
        results.written.push(file.path);
      } catch (err) {
        log.error(`Failed: ${file.path} — ${(err as Error).message}`);
        results.failed.push(file.path);
      }

      progress.tick(file.path);
    }

    progress.stop();
    saveLock(lock);

    totalWritten += results.written.length;
    totalFailed  += results.failed.length;
  }

  console.log();
  if (totalWritten) log.success(`${totalWritten} file(s) updated`);
  if (totalFailed) {
    log.error(`${totalFailed} file(s) failed`);
    process.exit(ExitCode.GeneralError);
  }

  if (totalWritten > 0) {
    runPostPullHook(config.postpull);
  }
}
