import * as p from '@clack/prompts';
import ora from 'ora';
import chalk from 'chalk';
import { loadConfig, saveConfig, migrateToMultiSource, CONFIG_FILE } from '../lib/config.js';
import { promptSource } from '../lib/sourcePrompt.js';
import {
  parseCollectionOrigin, loadCollection, checkDuplicates, backupConfig,
} from '../lib/collection.js';
import { log, fatal } from '../utils/logger.js';
import { isCI } from '../utils/context.js';
import { ExitCode } from '../types.js';
import type { RegisterOptions, SourceConfig, SynapConfig } from '../types.js';

export async function registerCommand(options: RegisterOptions = {}): Promise<void> {
  if (isCI()) {
    fatal('synap register cannot run in --ci mode (requires interactive input).', ExitCode.ConfigError);
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal((err as Error).message, ExitCode.ConfigError);
  }

  // ── Import from collection file ────────────────────────────────────────────
  if (options.from) {
    return importFromCollection(config, options);
  }

  // ── Interactive registration (original flow) ───────────────────────────────
  return interactiveRegister(config);
}

// ─── Import from collection / external config ─────────────────────────────────

async function importFromCollection(
  config: SynapConfig,
  options: RegisterOptions,
): Promise<void> {
  const migrated = migrateToMultiSource(config);
  /* v8 ignore start */
  const existing = migrated.sources ?? [];
  /* v8 ignore stop */

  p.intro(chalk.bold.cyan('  SynapCLI — Import Collection  '));

  // Parse origin and load
  let origin;
  try {
    origin = parseCollectionOrigin(options.from!, options.ref);
  } catch (err) {
    fatal((err as Error).message, ExitCode.ConfigError);
  }

  const spinner = ora('Loading collection…').start();

  let sources: SourceConfig[];
  let originLabel: string;
  try {
    ({ sources, originLabel } = await loadCollection(origin));
    spinner.succeed(`Loaded ${chalk.bold(sources.length)} source(s) from ${chalk.dim(originLabel)}`);
  } catch (err) {
    spinner.fail('Failed to load collection.');
    fatal((err as Error).message, ExitCode.ConfigError);
  }

  // Duplicate detection
  const { toAdd, skipped, nameConflicts } = checkDuplicates(sources, existing);

  if (skipped.length > 0) {
    console.log();
    log.dim(`Skipping ${skipped.length} duplicate(s) already registered:`);
    for (const s of skipped) {
      /* v8 ignore start */
      console.log(`  ${chalk.dim('•')} ${chalk.dim(s.name ?? s.repo)}`);
      /* v8 ignore stop */
    }
  }

  if (toAdd.length === 0) {
    console.log();
    log.warn('All sources in this collection are already registered. Nothing to import.');
    p.outro(chalk.dim('No changes made.'));
    return;
  }

  // Name conflict resolution
  for (const s of nameConflicts) {
    const choice = await p.select({
      message: `Name "${chalk.white(s.name)}" conflicts with an existing source. What would you like to do?`,
      options: [
        { value: 'rename', label: `Rename to "${s.name}-imported"` },
        { value: 'skip', label: 'Skip this source' },
      ],
    });

    /* v8 ignore start */
    if (p.isCancel(choice)) {
      p.cancel('Import cancelled.');
      process.exit(0);
    }
    /* v8 ignore stop */

    if (choice === 'skip') {
      const idx = toAdd.indexOf(s);
      /* v8 ignore start */
      if (idx !== -1) toAdd.splice(idx, 1);
      /* v8 ignore stop */
    } else {
      s.name = `${s.name}-imported`;
    }
  }

  if (toAdd.length === 0) {
    log.warn('No sources remaining after conflict resolution.');
    p.outro(chalk.dim('No changes made.'));
    return;
  }

  // Interactive localOutput confirmation (unless --yes)
  if (!options.yes) {
    console.log();
    log.info(`Confirm local output directories for ${toAdd.length} source(s):`);

    for (const [i, s] of toAdd.entries()) {
      console.log();
      /* v8 ignore start */
      console.log(chalk.bold.cyan(`  [${i + 1}/${toAdd.length}] ${s.name ?? s.repo}`));
      console.log(`        Repo:   ${chalk.white(s.repo)}`);
      console.log(`        Branch: ${chalk.white(s.branch)}`);
      if (s.remotePath) console.log(`        Remote: ${chalk.white(s.remotePath)}`);
      /* v8 ignore stop */

      const localOutput = await p.text({
        message: 'Local output directory',
        /* v8 ignore start */
        defaultValue: s.localOutput || '.',
        placeholder: s.localOutput || '.',
        /* v8 ignore stop */
      });

      /* v8 ignore start */
      if (p.isCancel(localOutput)) {
        p.cancel('Import cancelled.');
        process.exit(0);
      }
      /* v8 ignore stop */

      /* v8 ignore start */
      s.localOutput = (localOutput as string) || s.localOutput || '.';
      /* v8 ignore stop */
    }
  }

  // Tag with import origin
  for (const s of toAdd) {
    s._importedFrom = originLabel;
  }

  // Backup and save
  /* v8 ignore start */
  const backupPath = backupConfig();
  if (backupPath) {
    log.dim(`Config backed up to ${backupPath}`);
  }
  /* v8 ignore stop */

  migrated.sources = [...existing, ...toAdd];
  saveConfig(migrated);

  console.log();
  log.success(`Imported ${toAdd.length} source(s) from ${originLabel}:`);
  for (const s of toAdd) {
    /* v8 ignore start */
    console.log(`  ${chalk.green('•')} ${chalk.white(s.name ?? s.repo)} ${chalk.dim(`→ ${s.localOutput}`)}`);
    /* v8 ignore stop */
  }

  p.outro(chalk.green('Config updated'));
}

// ─── Original interactive registration ────────────────────────────────────────

async function interactiveRegister(config: SynapConfig): Promise<void> {
  p.intro(chalk.bold.cyan('  SynapCLI — Register Source  '));

  // ── Migrate to multi-source format if needed ───────────────────────────────
  const migrated = migrateToMultiSource(config);
  const wasLegacy = !config.sources;

  if (wasLegacy) {
    log.info(`Migrating ${CONFIG_FILE} to multi-source format…`);
  }

  // ── Show existing sources ──────────────────────────────────────────────────
  /* v8 ignore start */
  const existing = migrated.sources ?? [];
  if (existing.length > 0) {
    console.log();
    log.dim(`Currently registered sources (${existing.length}):`);
    for (const s of existing) {
      console.log(`  ${chalk.green('•')} ${chalk.white(s.name)} ${chalk.dim(`(${s.repo})`)}`);
    }
    /* v8 ignore stop */
  }

  // ── Collect new sources ────────────────────────────────────────────────────
  const newSources = [];
  let addingMore = true;
  let index = existing.length;

  while (addingMore) {
    const source = await promptSource(index);

    // Check for duplicate repo
    /* v8 ignore start */
    const duplicate = existing.find((s) => s.repo === source.repo && s.remotePath === source.remotePath);
    /* v8 ignore stop */
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
