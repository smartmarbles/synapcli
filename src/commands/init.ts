import * as p from '@clack/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync } from 'fs';
import { join } from 'path';
import { saveConfig, CONFIG_FILE, resolvedSources } from '../lib/config.js';
import { promptSource } from '../lib/sourcePrompt.js';
import { validateToken, hasToken } from '../lib/github.js';
import { completionCommand } from './completion.js';
import { isDirWritable } from '../utils/files.js';
import { log, fatal } from '../utils/logger.js';
import { isCI } from '../utils/context.js';
import { ExitCode } from '../types.js';
import type { SynapConfig, SourceConfig } from '../types.js';

export async function initCommand(): Promise<void> {
  if (isCI()) {
    fatal('synap init cannot run in --ci mode (requires interactive input).', ExitCode.ConfigError);
  }

  p.intro(chalk.bold.cyan('  SynapCLI — Init  '));

  const configPath = join(process.cwd(), CONFIG_FILE);
  if (existsSync(configPath)) {
    const overwrite = await p.confirm({
      message: `${CONFIG_FILE} already exists. Overwrite it?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel('Init cancelled.');
      process.exit(0);
    }
  }

  // ── Collect sources ────────────────────────────────────────────────────────
  const sources: SourceConfig[] = [];
  let addingMore = true;
  let index = 0;

  while (addingMore) {
    const source = await promptSource(index);
    sources.push(source);
    index++;

    const another = await p.confirm({
      message: `Source ${chalk.cyan(source.name)} added. Register another repository?`,
      initialValue: false,
    });

    if (p.isCancel(another) || !another) {
      addingMore = false;
    }
  }

  // ── Token validation ───────────────────────────────────────────────────────
  if (hasToken()) {
    const spinner = ora('Validating GitHub token…').start();
    try {
      const username = await validateToken();
      spinner.succeed(`Token valid — authenticated as ${chalk.bold(username)}`);
    } catch (err) {
      spinner.fail('Token validation failed');
      log.warn((err as Error).message);
      log.warn('Continuing anyway — you can fix your token before running synap pull.');
    }
  }

  // ── Save config ────────────────────────────────────────────────────────────
  const config: SynapConfig = sources.length === 1
    ? {
        // Single source — use simple flat format
        repo:        sources[0].repo,
        branch:      sources[0].branch,
        remotePath:  sources[0].remotePath,
        localOutput: sources[0].localOutput,
      }
    : {
        // Multiple sources — use sources array format
        sources,
      };

  saveConfig(config);

  console.log();
  log.success(`Created ${CONFIG_FILE} with ${sources.length} source(s):`);
  for (const s of sources) {
    console.log(`  ${chalk.green('•')} ${chalk.white(s.name)} ${chalk.dim(`(${s.repo})`)}`);
  }

  p.outro(chalk.green('Config saved'));

  // ── Silent post-init health check ─────────────────────────────────────────
  const configuredSources = resolvedSources(config);
  const warnings: string[] = [];

  for (const source of configuredSources) {
    if (!isDirWritable(source.localOutput)) {
      /* v8 ignore next */
      warnings.push(`Output directory ${chalk.white(source.localOutput)} for ${chalk.white(source.name ?? source.repo)} is not writable`);
    }
  }

  if (!hasToken()) {
    warnings.push(`No GitHub token found — private repos will fail. Run: ${chalk.white('git config --global synapcli.githubToken <token>')}`);
  }

  if (warnings.length > 0) {
    console.log();
    log.warn('Setup completed with warnings:');
    for (const w of warnings) {
      console.log(`  ${chalk.yellow('⚠')} ${w}`);
    }
  }

  // ── Shell completion ───────────────────────────────────────────────────────
  const installCompletion = await p.confirm({
    message: 'Install shell tab completion now? (lets you tab-complete file names)',
    initialValue: true,
  });

  if (!p.isCancel(installCompletion) && installCompletion) {
    await completionCommand(undefined, { install: true });
  } else {
    log.dim(`You can install it later with: ${chalk.white('synap completion --install')}`);
  }

  log.dim(
    `\nNext steps:\n  synap list       — browse available files\n  synap pull       — download everything\n  synap register   — add another repository later\n  synap doctor     — check your setup\n`
  );
}
