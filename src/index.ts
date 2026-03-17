#!/usr/bin/env node

import { program } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { setCI } from './utils/context.js';
import { getCompletions } from './lib/completionCache.js';

import { initCommand }       from './commands/init.js';
import { pullCommand }       from './commands/pull.js';
import { listCommand }       from './commands/list.js';
import { diffCommand }       from './commands/diff.js';
import { updateCommand }     from './commands/update.js';
import { deleteCommand }     from './commands/delete.js';
import { statusCommand }     from './commands/status.js';
import { doctorCommand }     from './commands/doctor.js';
import { completionCommand } from './commands/completion.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf8')
) as { version: string };

// ── Hidden: called by shell completion scripts ─────────────────────────────
// Checked before program.parse() so it exits immediately and silently
const getCompIdx = process.argv.indexOf('--get-completions');
if (getCompIdx !== -1) {
  const partial = process.argv[getCompIdx + 1] ?? '';
  const matches = getCompletions(partial);
  if (matches.length > 0) console.log(matches.join('\n'));
  process.exit(0);
}

// ── Global options ─────────────────────────────────────────────────────────

program
  .name('synap')
  .description('Pull agent and prompt files from a GitHub repository')
  .version(pkg.version)
  .option('--ci', 'CI mode: no interactive prompts, plain text output, strict failures')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts<{ ci?: boolean }>();
    if (opts.ci) setCI(true);
  });

// ── Commands ───────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Bootstrap SynapCLI config for this project')
  .action(initCommand);

program
  .command('pull [name]')
  .description('Fetch a specific agent/prompt by name, or all of them')
  .option('-f, --force',            'Overwrite local files without prompting')
  .option('-i, --interactive',      'Interactively select which files to pull')
  .option('-d, --dry-run',          'Preview what would be downloaded without writing files')
  .option('--ref <ref>',            'Override the branch, tag, or commit SHA to pull from')
  .option('--retry-failed',         'Only retry files that failed in the last pull')
  .action(pullCommand);

program
  .command('list')
  .description('List available agents and prompts in the remote repo')
  .option('--json', 'Output as JSON')
  .action(listCommand);

program
  .command('status')
  .description('Show the sync status of all tracked files (up-to-date, changed, missing)')
  .action(statusCommand);

program
  .command('diff [name]')
  .description('Show what has changed upstream vs your local files')
  .action(diffCommand);

program
  .command('update [name]')
  .description('Pull only files that have changed upstream')
  .option('-f, --force',       'Skip confirmation prompts')
  .option('-i, --interactive', 'Interactively select which files to update')
  .action(updateCommand);

program
  .command('delete [name]')
  .description('Delete a tracked file (or all tracked files) from disk and remove from lock')
  .option('-f, --force',   'Skip confirmation prompt')
  .option('-d, --dry-run', 'Preview what would be deleted without removing anything')
  .action(deleteCommand);

program
  .command('doctor')
  .description('Validate your setup: Node version, token, repo access, and config')
  .action(doctorCommand);

program
  .command('completion [shell]')
  .description('Output or install shell tab completion (bash, zsh, fish, powershell)')
  .option('--install', 'Append the completion script to your shell config file')
  .action(completionCommand);

program.parse();
