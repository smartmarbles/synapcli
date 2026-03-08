import * as p from '@clack/prompts';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { join } from 'path';
import { saveConfig, CONFIG_FILE, parseRepoString } from '../lib/config.js';
import { log, fatal } from '../utils/logger.js';

export async function initCommand() {
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
          validate: (val) => {
            try {
              parseRepoString(val);
            } catch {
              return 'Enter a valid "owner/repo" or GitHub URL';
            }
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
          placeholder: 'src/agents',
          defaultValue: 'src/agents',
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

  const { owner, repo } = parseRepoString(answers.repo);

  const config = {
    repo: `${owner}/${repo}`,
    branch: answers.branch || 'main',
    remotePath: answers.remotePath || '',
    localOutput: answers.localOutput || 'src/agents',
    ...(answers.privateRepo && {
      auth: 'env:GITHUB_TOKEN',
    }),
  };

  saveConfig(config);

  p.outro(chalk.green(`Created ${CONFIG_FILE}`));

  if (answers.privateRepo) {
    log.info(`Set ${chalk.bold('GITHUB_TOKEN')} in your environment or a ${chalk.bold('.env')} file for private repo access.`);
  }

  log.dim(`\nNext steps:\n  synap list        — browse available files\n  synap pull        — download everything\n  synap pull <name> — download a specific file\n`);
}
