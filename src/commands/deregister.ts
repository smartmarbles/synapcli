import * as p from '@clack/prompts';
import chalk from 'chalk';
import { loadConfig, saveConfig, migrateToMultiSource, loadLock, saveLock, CONFIG_FILE } from '../lib/config.js';
import { log, fatal } from '../utils/logger.js';
import { isCI } from '../utils/context.js';
import { ExitCode } from '../types.js';

export async function deregisterCommand(): Promise<void> {
  if (isCI()) {
    fatal('synap deregister cannot run in --ci mode (requires interactive input).', ExitCode.ConfigError);
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal((err as Error).message, ExitCode.ConfigError);
  }

  p.intro(chalk.bold.cyan('  SynapCLI — Deregister Source  '));

  const migrated = migrateToMultiSource(config);
  /* v8 ignore start */
  const sources = migrated.sources ?? [];
  /* v8 ignore stop */

  if (sources.length === 0) {
    log.warn('No sources are registered.');
    /* v8 ignore start */
    process.exit(0);
    /* v8 ignore stop */
  }

  // ── Select sources to remove ───────────────────────────────────────────────
  const selected = await p.multiselect({
    message: 'Select sources to remove:',
    options: sources.map((s) => ({
      value: s.repo,
      /* v8 ignore start */
      label: chalk.white(s.name ?? s.repo),
      /* v8 ignore stop */
      hint: s.repo,
    })),
    required: true,
  });

  if (p.isCancel(selected)) {
    p.cancel('Deregister cancelled.');
    process.exit(0);
  }

  const toRemove = selected as string[];

  // ── Confirm ────────────────────────────────────────────────────────────────
  console.log();
  log.warn(`The following sources will be removed from ${CONFIG_FILE}:`);
  for (const repo of toRemove) {
    const source = sources.find((s) => s.repo === repo)!;
    console.log(`  ${chalk.red('✖')} ${chalk.white(source.name)} ${chalk.dim(`(${source.repo})`)}`);
  }
  console.log();
  log.dim('Note: local files already pulled will not be deleted. Run synap delete to remove them.');
  console.log();

  const confirmed = await p.confirm({
    message: `Remove ${toRemove.length} source(s) from config?`,
    initialValue: false,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Deregister cancelled.');
    process.exit(0);
  }

  // ── Update config ──────────────────────────────────────────────────────────
  const remaining = sources.filter((s) => !toRemove.includes(s.repo));

  let updatedConfig;
  if (remaining.length === 1) {
    // Downgrade back to simple single-source format
    updatedConfig = {
      repo:        remaining[0].repo,
      branch:      remaining[0].branch,
      remotePath:  remaining[0].remotePath,
      localOutput: remaining[0].localOutput,
      ...(migrated.postpull && { postpull: migrated.postpull }),
    };
  } else if (remaining.length > 1) {
    updatedConfig = { ...migrated, sources: remaining };
  } else {
    // All sources removed — save empty sources array
    updatedConfig = { sources: [] };
  }

  saveConfig(updatedConfig);

  // ── Clean orphaned lock entries ────────────────────────────────────────────
  const lock = loadLock();
  let lockCleaned = 0;

  for (const repo of toRemove) {
    const prefix = `${repo}::`;
    for (const key of Object.keys(lock)) {
      if (key.startsWith(prefix)) {
        delete lock[key];
        lockCleaned++;
      }
    }
  }

  if (lockCleaned > 0) {
    saveLock(lock);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log();
  log.success(`Removed ${toRemove.length} source(s) from ${CONFIG_FILE}`);
  if (lockCleaned > 0) {
    /* v8 ignore start */
    log.success(`Cleaned ${lockCleaned} lock entr${lockCleaned === 1 ? 'y' : 'ies'} from synap.lock.json`);
    /* v8 ignore stop */
  }

  if (remaining.length > 0) {
    console.log();
    log.dim(`Remaining sources (${remaining.length}):`);
    for (const s of remaining) {
      console.log(`  ${chalk.green('•')} ${chalk.white(s.name)} ${chalk.dim(`(${s.repo})`)}`);
    }
  } else {
    log.warn('No sources remaining. Run synap init or synap register to add one.');
  }

  p.outro(chalk.green('Config updated'));
}
