import ora from 'ora';
import chalk from 'chalk';
import {
  loadConfig, parseRepoString, loadLock, saveLock,
  resolvedSources, lockKey,
} from '../lib/config.js';
import { fetchAllFiles, fetchFileContent } from '../lib/github.js';
import { filterFiles } from '../lib/filter.js';
import { runPostPullHook } from '../lib/hooks.js';
import { previewAndConfirm, type PreviewFile } from '../lib/preview.js';
import { writeCompletionCache } from '../lib/completionCache.js';
import { writeFile, resolveLocalPath } from '../utils/files.js';
import { log, fatal } from '../utils/logger.js';
import { SynapProgress } from '../utils/progress.js';
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
    const repoKey = `${owner}/${repo}`;

    // ── Discover changed files ───────────────────────────────────────────────
    const spinner = ora(`[${chalk.cyan(label)}] Checking for upstream changes…`).start();
    let allFiles;
    try {
      allFiles = await fetchAllFiles({ owner, repo, path: remotePath, ref });
      spinner.succeed(`[${chalk.cyan(label)}] Scanned ${chalk.bold(allFiles.length)} remote file(s)`);
      writeCompletionCache(allFiles.map((f) => f.path));
    } catch (err) {
      spinner.fail(`Failed to fetch from ${label}`);
      fatal((err as Error).message, ExitCode.NetworkError);
    }

    let targets = filterFiles(allFiles, source);
    if (name) targets = targets.filter((f) => f.path.includes(name));

    // Only files whose SHA has changed since last pull
    const changed = targets.filter((f) => {
      const entry = lock[lockKey(repoKey, f.path)];
      return !entry || entry.sha !== f.sha;
    });

    if (changed.length === 0) {
      log.success(`[${label}] All files up to date.`);
      continue;
    }

    // ── Build preview items ─────────────────────────────────────────────────
    const previewItems: PreviewFile[] = changed.map((file) => ({
      file,
      localPath: resolveLocalPath({ remotePath: file.path, remoteBase: remotePath, localOutput: source.localOutput }),
      isNew: !lock[lockKey(repoKey, file.path)],
      source,
    }));

    // ── Status preview + confirmation (or interactive multiselect) ──────────
    const confirmed = await previewAndConfirm(previewItems, {
      verb: 'Update',
      force: options.force,
      interactive: options.interactive,
    });

    if (!confirmed || confirmed.length === 0) continue;

    // ── Update selected files ───────────────────────────────────────────────
    const progress = new SynapProgress(confirmed.length, 'files');
    const results = { written: [] as string[], failed: [] as string[] };

    for (const item of confirmed) {
      const { file, localPath } = item;

      try {
        const { content, sha } = await fetchFileContent({ owner, repo, path: file.path, ref });
        writeFile(localPath, content);
        lock[lockKey(repoKey, file.path)] = { sha, ref, pulledAt: new Date().toISOString() };
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
