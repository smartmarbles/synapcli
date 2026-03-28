import * as p from '@clack/prompts';
import chalk from 'chalk';
import { loadConfig, saveConfig, migrateToMultiSource, CONFIG_FILE } from '../lib/config.js';
import { promptSource } from '../lib/sourcePrompt.js';
import { log, fatal } from '../utils/logger.js';
import { isCI } from '../utils/context.js';
import { ExitCode } from '../types.js';

export async function registerCommand(): Promise<void> {
  if (isCI()) {
    fatal('synap register cannot run in --ci mode (requires interactive input).', ExitCode.ConfigError);
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal((err as Error).message, ExitCode.ConfigError);
  }

  p.intro(chalk.bold.cyan('  SynapCLI — Register Source  '));

  // ── Migrate to multi-source format if needed ───────────────────────────────
  const migrated = migrateToMultiSource(config);
  const wasLegacy = !config.sources;

  if (wasLegacy) {
    log.info(`Migrating ${CONFIG_FILE} to multi-source format…`);
  }

  // ── Show existing sources ──────────────────────────────────────────────────
  /* v8 ignore next */
  const existing = migrated.sources ?? [];
  if (existing.length > 0) {
    console.log();
    /* v8 ignore next */
    log.dim(`Currently registered sources (${existing.length}):`);
    for (const s of existing) {
      /* v8 ignore next */
      console.log(`  ${chalk.green('•')} ${chalk.white(s.name)} ${chalk.dim(`(${s.repo})`)}`);
    }
  }

  // ── Collect new sources ────────────────────────────────────────────────────
  const newSources = [];
  let addingMore = true;
  let index = existing.length;

  while (addingMore) {
    const source = await promptSource(index);

    // Check for duplicate repo
    /* v8 ignore next */
    const duplicate = existing.find((s) => s.repo === source.repo && s.remotePath === source.remotePath);
    if (duplicate) {
      log.warn(`${chalk.white(source.repo)} with remotePath "${source.remotePath}" is already registered as "${duplicate.name}". Skipping.`);
    } else {
      newSources.push(source);
      index++;
    }

    const another = await p.confirm({
      message: duplicate
        ? 'Register another repository?'
        : `Source ${chalk.cyan(source.name)} added. Register another?`,
      initialValue: false,
    });

    if (p.isCancel(another) || !another) {
      addingMore = false;
    }
  }

  if (newSources.length === 0) {
    log.warn('No new sources added.');
    process.exit(0);
  }

  // ── Save updated config ────────────────────────────────────────────────────
  migrated.sources = [...existing, ...newSources];
  saveConfig(migrated);

  console.log();
  log.success(`Added ${newSources.length} source(s) to ${CONFIG_FILE}:`);
  for (const s of newSources) {
    console.log(`  ${chalk.green('•')} ${chalk.white(s.name)} ${chalk.dim(`(${s.repo})`)}`);
  }

  p.outro(chalk.green('Config updated'));

  log.dim(`\nRun ${chalk.white('synap list')} to browse all files across your registered sources.`);
}
