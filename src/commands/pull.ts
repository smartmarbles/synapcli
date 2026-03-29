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
import { previewAndConfirm, type PreviewFile } from '../lib/preview.js';
import { writeCompletionCache } from '../lib/completionCache.js';
import { writeFile, readLocalFile, resolveLocalPath, computeGitBlobSha } from '../utils/files.js';
import { log, fatal } from '../utils/logger.js';
import { SynapProgress } from '../utils/progress.js';
import { isCI } from '../utils/context.js';
import { ExitCode } from '../types.js';
import type { PullOptions } from '../types.js';

const FAILED_KEY = '__failed__';

export async function pullCommand(
  name: string | undefined,
  options: PullOptions
): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal((err as Error).message, ExitCode.ConfigError);
  }

  const sources = resolvedSources(config);
  const lock = loadLock();
  const globalResults = { written: 0, skipped: 0, failed: 0 };

  for (const source of sources) {
    const { owner, repo } = parseRepoString(source.repo);
    /* v8 ignore start */
    const ref = options.ref ?? source.branch ?? 'main';
    const remotePath = source.remotePath || '';
    const label = source.name ?? source.repo;
    const repoKey = `${owner}/${repo}`;
    /* v8 ignore stop */

    // ── Discover files ──────────────────────────────────────────────────────
    const spinner = ora(`[${chalk.cyan(label)}] Fetching file list…`).start();
    let allFiles;
    try {
      allFiles = await fetchAllFiles({ owner, repo, path: remotePath, ref });
      spinner.succeed(`[${chalk.cyan(label)}] Found ${chalk.bold(allFiles.length)} file(s)`);
      writeCompletionCache(allFiles.map((f) => f.path));
    } catch (err) {
      spinner.fail(`Failed to fetch file list from ${label}`);
      fatal((err as Error).message, ExitCode.NetworkError);
    }

    let targets = filterFiles(allFiles, source);

    // ── --retry-failed ──────────────────────────────────────────────────────
    if (options.retryFailed) {
      const failedKey = lockKey(repoKey, FAILED_KEY);
      const failedPaths: string[] = (lock[failedKey] as unknown as string[] | undefined) ?? [];
      if (failedPaths.length === 0) {
        log.info(`No failed files recorded for ${label}.`);
        continue;
      }
      targets = targets.filter((f) => failedPaths.includes(f.path));
      log.info(`Retrying ${targets.length} previously failed file(s) in ${label}…`);
    }

    // ── Name filter ─────────────────────────────────────────────────────────
    if (name) targets = targets.filter((f) => f.path.includes(name));

    if (targets.length === 0) {
      log.warn(name ? `No files matched "${name}" in ${label}` : `No files found in ${label}.`);
      continue;
    }

    // ── Dry run ─────────────────────────────────────────────────────────────
    if (options.dryRun) {
      log.title(`[${label}] Dry run — files that would be downloaded:`);
      console.log();
      for (const file of targets) {
        const localPath = resolveLocalPath({ remotePath: file.path, remoteBase: remotePath, localOutput: source.localOutput });
        log.dryRun(`${chalk.white(file.path)} → ${chalk.dim(localPath)}`);
      }
      console.log();
      continue;
    }

    // ── Build preview items ─────────────────────────────────────────────────
    const previewItems: PreviewFile[] = targets.map((file) => {
      const localPath = resolveLocalPath({ remotePath: file.path, remoteBase: remotePath, localOutput: source.localOutput });
      const key = lockKey(repoKey, file.path);
      const entry = lock[key];
      const localSha = computeGitBlobSha(localPath);
      const locallyModified = !!entry && localSha !== null && localSha !== entry.sha;
      return { file, localPath, isNew: !entry, source, locallyModified };
    });

    // ── Status preview + confirmation (or interactive multiselect) ──────────
    const confirmed = await previewAndConfirm(previewItems, {
      verb: 'Pull',
      force: options.force,
      interactive: options.interactive,
    });

    /* v8 ignore next 2 */
    if (!confirmed || confirmed.length === 0) continue;

    // ── Pull selected files ─────────────────────────────────────────────────
    const results = { written: [] as string[], skipped: [] as string[], failed: [] as string[] };
    /* v8 ignore next */
    const progress = new SynapProgress(confirmed.length, 'files');

    for (const item of confirmed) {
      const { file, localPath } = item;
      const existing = readLocalFile(localPath);
      const key = lockKey(repoKey, file.path);
      const alreadyLocked = lock[key];

      // Conflict: file exists locally and wasn't put there by synap
      if (existing !== null && !alreadyLocked && !options.force) {
        if (isCI()) {
          log.warn(`Conflict on ${localPath} — skipping (use --force to overwrite in CI).`);
          results.skipped.push(file.path);
          progress.tick(file.path);
          continue;
        }

        progress.stop();
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

      try {
        const { content, sha } = await fetchFileContent({ owner, repo, path: file.path, ref });
        writeFile(localPath, content);
        lock[key] = { sha, ref, pulledAt: new Date().toISOString() };
        results.written.push(file.path);
      } catch (err) {
        log.error(`Failed: ${file.path} — ${(err as Error).message}`);
        results.failed.push(file.path);
      }

      progress.tick(file.path);
    }

    progress.stop();

    // Store failed paths in lock for --retry-failed
    const failedKey = lockKey(repoKey, FAILED_KEY);
    if (results.failed.length > 0) {
      (lock as Record<string, unknown>)[failedKey] = results.failed;
    } else {
      delete lock[failedKey];
    }

    saveLock(lock);

    globalResults.written  += results.written.length;
    globalResults.skipped  += results.skipped.length;
    globalResults.failed   += results.failed.length;
  }

  console.log();
  if (globalResults.written)  log.success(`${globalResults.written} file(s) written`);
  if (globalResults.skipped)  log.warn(`${globalResults.skipped} file(s) skipped`);
  if (globalResults.failed) {
    log.error(`${globalResults.failed} file(s) failed — run ${chalk.white('synap pull --retry-failed')} to retry`);
    process.exit(ExitCode.GeneralError);
  }

  if (globalResults.written > 0) {
    runPostPullHook(config.postpull);
  }
}
