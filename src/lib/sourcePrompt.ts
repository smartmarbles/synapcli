import * as p from '@clack/prompts';
import chalk from 'chalk';
import { parseRepoString } from '../lib/config.js';
import type { SourceConfig } from '../types.js';

// ─── Common output directory presets ──────────────────────────────────────────

const OUTPUT_PRESETS = [
  {
    value: '.',
    label: 'Project root',
    hint: '.',
  },
  {
    value: '.github',
    label: 'GitHub Copilot',
    hint: '.github/',
  },
  {
    value: '.claude',
    label: 'Claude Code',
    hint: '.claude/',
  },
  {
    value: '.gemini',
    label: 'Gemini Code Assist',
    hint: '.gemini/',
  },
  {
    value: 'custom',
    label: 'Enter a custom path…',
    hint: '',
  },
];

/**
 * Interactively prompt the user to configure a single source.
 * Used by both `synap init` and `synap register`.
 */
export async function promptSource(index?: number): Promise<SourceConfig> {
  const label = index !== undefined ? `Source ${index + 1}` : 'Source';
  console.log();
  console.log(chalk.bold.cyan(`  ${label}`));

  /* v8 ignore start */
  const answers = await p.group(
    {
      repo: () =>
        p.text({
          message: 'GitHub repository (owner/repo or full URL)',
          placeholder: 'acme-org/ai-agents',
          validate: (val: string | undefined) => {
            if (!val) return 'Enter a valid "owner/repo" or GitHub URL';
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

      localOutputPreset: () =>
        p.select({
          message: 'Local output directory',
          options: OUTPUT_PRESETS,
          initialValue: '.',
        }),

      localOutputCustom: ({ results }) =>
        results.localOutputPreset === 'custom'
          ? p.text({
              message: 'Enter custom output directory',
              placeholder: '.',
              defaultValue: '.',
            })
          : Promise.resolve(undefined),
    },
    {
      onCancel: () => {
        /* v8 ignore start */
        p.cancel('Cancelled.');
        process.exit(0);
        /* v8 ignore stop */
      },
    }
  );
  /* v8 ignore stop */

  const { owner, repo } = parseRepoString(answers.repo as string);
  const repoString = `${owner}/${repo}`;

  const localOutput =
    answers.localOutputPreset === 'custom'
      ? ((answers.localOutputCustom as string) || '.')
      : (answers.localOutputPreset as string);

  return {
    /* v8 ignore start */
    name: (answers.name as string) || repoString,
    repo: repoString,
    branch: (answers.branch as string) || 'main',
    remotePath: (answers.remotePath as string) || '',
    /* v8 ignore stop */
    localOutput,
  };
}
