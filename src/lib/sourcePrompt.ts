import * as p from '@clack/prompts';
import chalk from 'chalk';
import { parseRepoString } from '../lib/config.js';
import type { SourceConfig } from '../types.js';

/**
 * Interactively prompt the user to configure a single source.
 * Used by both `synap init` and `synap register`.
 */
export async function promptSource(index?: number): Promise<SourceConfig> {
  const label = index !== undefined ? `Source ${index + 1}` : 'Source';
  console.log();
  console.log(chalk.bold.cyan(`  ${label}`));

  const answers = await p.group(
    {
      repo: () =>
        p.text({
          message: 'GitHub repository (owner/repo or full URL)',
          placeholder: 'acme-org/ai-agents',
          validate: (val: string) => {
            try { parseRepoString(val); }
            catch { return 'Enter a valid "owner/repo" or GitHub URL'; }
          },
        }),

      name: () =>
        p.text({
          message: 'Friendly name for this source (shown in output)',
          placeholder: 'Agents',
          defaultValue: '',
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
    },
    {
      onCancel: () => {
        p.cancel('Cancelled.');
        process.exit(0);
      },
    }
  );

  const { owner, repo } = parseRepoString(answers.repo as string);
  const repoString = `${owner}/${repo}`;

  return {
    name: (answers.name as string) || repoString,
    repo: repoString,
    branch: (answers.branch as string) || 'main',
    remotePath: (answers.remotePath as string) || '',
    localOutput: (answers.localOutput as string) || '.',
  };
}
