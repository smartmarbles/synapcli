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
import { registerCommand }   from './commands/register.js';
import { deregisterCommand } from './commands/deregister.js';
import { installCommand }    from './commands/install.js';
import { collectionCreateCommand } from './commands/collection.js';

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
  .command('list [path]')
  .description('List available agents and prompts in the remote repo')
  .option('--json', 'Output as JSON')
  .option('-s, --source <name>', 'Only list files from the named source')
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

program
  .command('register')
  .description('Add one or more repositories to an existing synap.config.json')
  .option('--from <source>', 'Import sources from a collection file, GitHub URL, or org/repo/path shorthand')
  .option('--ref <ref>',     'Branch to use when fetching a remote collection (default: main)')
  .option('-y, --yes',       'Accept default local output directories without prompting')
  .action(registerCommand);

program
  .command('deregister')
  .description('Remove a registered repository from synap.config.json')
  .action(deregisterCommand);

program
  .command('install <source>')
  .description('Install files from an asset collection')
  .option('-y, --yes',           'Accept all resolved paths without prompting')
  .option('--preset <name>',     'Override the development system preset for this install')
  .option('-d, --dry-run',       'Preview what would be installed without writing files')
  .action(installCommand);

const collectionCmd = program
  .command('collection')
  .description('Author and manage asset collections');

collectionCmd
  .command('create <name>')
  .description('Create a collection file from tracked files')
  .option('--json', 'Output to stdout as JSON instead of writing a file')
  .action(collectionCreateCommand);

// Use parseAsync so that async action errors propagate as rejected promises.
// Never call process.exit() — just let the event loop drain naturally.
// Node uses process.exitCode (set by fatal()) when exiting on its own, and
// undici's internal handles are closed by then, avoiding the Windows libuv
// assertion crash (src\win\async.c) triggered by a forced exit mid-request.
program.parseAsync().catch(() => {
  if (!process.exitCode) process.exitCode = 1;
});
