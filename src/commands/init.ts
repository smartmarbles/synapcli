import * as p from '@clack/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync } from 'fs';
import { join } from 'path';
import { saveConfig, CONFIG_FILE, parseRepoString } from '../lib/config.js';
import { validateToken, hasToken } from '../lib/github.js';
import { completionCommand } from './completion.js';
import { log, fatal } from '../utils/logger.js';
import { isCI } from '../utils/context.js';
import { ExitCode, type SynapConfig } from '../types.js';

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

  const answers = await p.group(
    {
      repo: () =>
        p.text({
          message: 'GitHub repository (owner/repo or full URL)',
          placeholder: 'acme/ai-agents',
          validate: (val: string) => {
            try { parseRepoString(val); }
            catch { return 'Enter a valid "owner/repo" or GitHub URL'; }
          },
        }),

      branch: () =>
        p.text({
          message: 'Default branch, tag, or commit SHA',
          placeholder: 'main',
          defaultValue: 'main',
        }),

      remotePath: () =>
        p.text({
          message: 'Path inside the repo to pull from (leave blank for root)',
          placeholder: 'agents',
          defaultValue: '',
        }),

      localOutput: () =>
        p.text({
          message: 'Local output directory',
          placeholder: '.',
          defaultValue: '.',
        }),

      privateRepo: () =>
        p.confirm({
          message: 'Is this a private repository?',
          initialValue: false,
        }),
    },
    {
      onCancel: () => {
        p.cancel('Init cancelled.');
        process.exit(0);
      },
    }
  );

  const { owner, repo } = parseRepoString(answers.repo as string);

  const config: SynapConfig = {
    repo: `${owner}/${repo}`,
    branch:      (answers.branch as string)      || 'main',
    remotePath:  (answers.remotePath as string)  || '',
    localOutput: (answers.localOutput as string) || '.',
    ...(answers.privateRepo && { auth: 'env:GITHUB_TOKEN' }),
  };

  // ── Token validation ──────────────────────────────────────────────────────
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
  } else if (answers.privateRepo) {
    log.warn(
      `No GitHub token found. Set ${chalk.bold('GITHUB_TOKEN')} in your environment, ` +
      `or run: ${chalk.white('git config --global synapcli.githubToken <token>')}`
    );
  }

  saveConfig(config);
  p.outro(chalk.green(`Created ${CONFIG_FILE}`));

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
    `\nNext steps:\n  synap list       — browse available files\n  synap pull       — download everything\n  synap pull <n>   — download a specific file\n  synap doctor     — check your setup\n`
  );
}
