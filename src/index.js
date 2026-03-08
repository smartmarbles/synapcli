#!/usr/bin/env node

import 'dotenv/config';
import { program } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { initCommand } from './commands/init.js';
import { pullCommand } from './commands/pull.js';
import { listCommand } from './commands/list.js';
import { diffCommand } from './commands/diff.js';
import { updateCommand } from './commands/update.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

program
  .name('synap')
  .description('Pull agent and prompt files from a GitHub repository')
  .version(pkg.version);

program
  .command('init')
  .description('Bootstrap SynapCLI config for this project')
  .action(initCommand);

program
  .command('pull [name]')
  .description('Fetch a specific agent/prompt by name, or all of them')
  .option('-f, --force', 'Overwrite local files without prompting')
  .option('-d, --dry-run', 'Preview what would be downloaded without writing files')
  .option('--branch <branch>', 'Override the branch/tag/SHA to pull from')
  .action(pullCommand);

program
  .command('list')
  .description('List available agents and prompts in the remote repo')
  .option('--json', 'Output as JSON')
  .action(listCommand);

program
  .command('diff [name]')
  .description('Show what has changed upstream vs your local files')
  .action(diffCommand);

program
  .command('update [name]')
  .description('Pull only files that have changed upstream')
  .option('-f, --force', 'Skip confirmation prompts')
  .action(updateCommand);

program.parse();
