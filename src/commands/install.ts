import ora from 'ora';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import { join, basename } from 'path';
import {
  loadConfig, saveConfig, parseRepoString, loadLock, saveLock, lockKey,
} from '../lib/config.js';
import { fetchFileContent } from '../lib/github.js';
import { parseCollectionOrigin, loadAssetCollection, groupByOutput, assetKey } from '../lib/collection.js';
import { PRESET_OPTIONS, isValidPreset, applyPreset } from '../lib/presets.js';
import { writeFile } from '../utils/files.js';
import { log, fatal } from '../utils/logger.js';
import { isCI } from '../utils/context.js';
import { SynapProgress } from '../utils/progress.js';
import { ExitCode } from '../types.js';
import type { InstallOptions, CollectionAsset, LockFile } from '../types.js';

/** Lockfile key prefix for collection definition entries */
const COLLECTION_PREFIX = '_collection::';

export function collectionLockKey(name: string): string {
  return `${COLLECTION_PREFIX}${name}`;
}

export async function installCommand(
  source: string,
  options: InstallOptions,
): Promise<void> {
  // ── Load config (for preset) ────────────────────────────────────────────
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal((err as Error).message, ExitCode.ConfigError);
  }

  p.intro(chalk.bold.cyan('  SynapCLI — Install Collection  '));

  // ── Load collection ─────────────────────────────────────────────────────
  let origin;
  try {
    origin = parseCollectionOrigin(source);
  } catch (err) {
    fatal((err as Error).message, ExitCode.ConfigError);
  }

  const spinner = ora('Loading collection…').start();

  let collection;
  let originLabel: string;
  try {
    ({ collection, originLabel } = await loadAssetCollection(origin));
    spinner.succeed(
      `Loaded ${chalk.bold(collection.name)} — ${collection.assets.length} asset(s) from ${chalk.dim(originLabel)}`
    );
  } catch (err) {
    spinner.fail('Failed to load collection.');
    fatal((err as Error).message, ExitCode.ConfigError);
  }

  // ── Resolve preset ──────────────────────────────────────────────────────
  let preset = options.preset ?? config.preset;

  if (preset && !isValidPreset(preset)) {
    fatal(`Unknown preset "${preset}". Valid: ${PRESET_OPTIONS.map((o) => o.value).join(', ')}`, ExitCode.ConfigError);
  }

  if (!preset) {
    if (isCI() || options.yes) {
      preset = 'copilot';
    } else {
      const choice = await p.select({
        message: 'Which development system are you using?',
        options: PRESET_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
          hint: o.hint || undefined,
        })),
      });

      /* v8 ignore start */
      if (p.isCancel(choice)) {
        p.cancel('Install cancelled.');
        process.exit(0);
      }
      /* v8 ignore stop */

      preset = choice as string;
    }

    // Persist preset to config for future installs
    config.preset = preset;
    saveConfig(config);
    log.dim(`Saved preset "${preset}" to synap.config.json`);
  }

  // ── Apply preset remapping ──────────────────────────────────────────────
  const resolvedOutputs = new Map<string, string>();
  for (const asset of collection.assets) {
    resolvedOutputs.set(assetKey(asset), applyPreset(preset, asset.defaultOutput));
  }

  // ── Group by output + prompt per group ──────────────────────────────────
  const groups = groupByOutput(collection.assets, resolvedOutputs);
  const finalOutputs = new Map<string, string>();

  if (options.dryRun) {
    console.log();
    log.title(`[${collection.name}] Dry run — files that would be installed:`);
    console.log();
    for (const [output, assets] of groups) {
      /* v8 ignore start */
      console.log(`  ${chalk.cyan(output)} (${assets.length} file${assets.length > 1 ? 's' : ''})`);
      /* v8 ignore stop */
      for (const a of assets) {
        console.log(`    ${chalk.dim(basename(a.path))}`);
      }
    }
    console.log();
    p.outro(chalk.dim('Dry run complete — no files written.'));
    return;
  }

  console.log();
  log.info(
    `${chalk.bold(collection.name)} — ${collection.assets.length} asset(s)`,
  );
  console.log();

  for (const [output, assets] of groups) {
    const fileList = assets.map((a) => basename(a.path)).join(', ');

    if (options.yes) {
      // Accept the resolved output as-is
      for (const a of assets) {
        finalOutputs.set(assetKey(a), output);
      }
      continue;
    }

    const result = await p.text({
      /* v8 ignore start */
      message: `${chalk.cyan(output)} (${assets.length} file${assets.length > 1 ? 's' : ''}): ${chalk.dim(fileList)}`,
      /* v8 ignore stop */
      defaultValue: output,
      placeholder: output,
    });

    /* v8 ignore start */
    if (p.isCancel(result)) {
      p.cancel('Install cancelled.');
      process.exit(0);
    }
    /* v8 ignore stop */

    const confirmed = (result as string) || output;
    for (const a of assets) {
      finalOutputs.set(assetKey(a), confirmed);
    }
  }

  // ── Confirmation ────────────────────────────────────────────────────────
  if (!options.yes) {
    const confirm = await p.confirm({
      message: `Install ${collection.assets.length} file(s)?`,
      initialValue: true,
    });

    /* v8 ignore start */
    if (p.isCancel(confirm) || !confirm) {
      p.cancel('Install cancelled.');
      process.exit(0);
    }
    /* v8 ignore stop */
  }

  // ── Download + write ────────────────────────────────────────────────────
  const lock = loadLock();
  const results = { written: 0, failed: 0 };
  /* v8 ignore start */
  const progress = new SynapProgress(collection.assets.length, 'files');
  /* v8 ignore stop */

  for (const asset of collection.assets) {
    const { owner, repo } = parseRepoString(asset.repo);
    /* v8 ignore start */
    const outputDir = finalOutputs.get(assetKey(asset))
      ?? resolvedOutputs.get(assetKey(asset))
      ?? asset.defaultOutput;
    /* v8 ignore stop */
    const localPath = join(process.cwd(), outputDir, basename(asset.path));

    try {
      const { content, sha } = await fetchFileContent({
        owner, repo, path: asset.path, ref: asset.branch,
      });
      writeFile(localPath, content);

      const key = lockKey(asset.repo, asset.path);
      lock[key] = {
        sha,
        ref: asset.branch,
        pulledAt: new Date().toISOString(),
        collection: collection.name,
      };

      results.written++;
    } catch (err) {
      log.error(`Failed: ${asset.path} — ${(err as Error).message}`);
      results.failed++;
    }

    progress.tick(basename(asset.path));
  }

  progress.stop();

  // ── Store collection definition in lockfile ─────────────────────────────
  const pathOverrides: Record<string, string> = {};
  for (const asset of collection.assets) {
    /* v8 ignore start */
    const resolved = finalOutputs.get(assetKey(asset))
      ?? resolvedOutputs.get(assetKey(asset))
      ?? asset.defaultOutput;
    /* v8 ignore stop */
    if (resolved !== asset.defaultOutput) {
      pathOverrides[asset.defaultOutput] = resolved;
    }
  }

  lock[collectionLockKey(collection.name)] = {
    sha: '',
    ref: '',
    pulledAt: new Date().toISOString(),
    origin: originLabel,
    pathOverrides,
  };

  saveLock(lock);

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log();
  if (results.written) log.success(`${results.written} file(s) installed`);
  if (results.failed) {
    fatal(`${results.failed} file(s) failed`, ExitCode.GeneralError);
  }

  p.outro(chalk.green(`${collection.name} installed`));
}
