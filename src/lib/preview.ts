import chalk from 'chalk';
import * as p from '@clack/prompts';
import { isCI } from '../utils/context.js';
import { log } from '../utils/logger.js';
import type { PreviewFile } from '../types.js';

export type { PreviewFile };

/**
 * Show a status preview of files that are about to be pulled or updated.
 * In interactive mode, lets the user select which files to proceed with.
 * In normal mode, shows the list and asks a single yes/no confirmation.
 * In CI mode or with --force, skips all prompts entirely.
 *
 * Returns the subset of files the user confirmed, or null if cancelled.
 */
export async function previewAndConfirm(
  items: PreviewFile[],
  opts: {
    verb: 'Pull' | 'Update';
    force?: boolean;
    interactive?: boolean;
  }
): Promise<PreviewFile[] | null> {
  const { verb, force, interactive } = opts;

  if (items.length === 0) return [];

  // ── Skip all prompts in CI or --force ─────────────────────────────────────
  if (force || isCI()) return items;

  // ── Interactive multiselect ───────────────────────────────────────────────
  if (interactive) {
    console.log();
    const selected = await p.multiselect<PreviewFile>({
      message: `Select files to ${verb.toLowerCase()} (↑↓ navigate, space toggle, enter confirm):`,
      options: items.map((item) => ({
        value: item,
        label: chalk.white(item.file.path),
        hint: item.isNew ? chalk.dim('new') : chalk.yellow('changed'),
      })),
      initialValues: items, // all selected by default
      required: false,
    });

    if (p.isCancel(selected)) {
      p.cancel(`${verb} cancelled.`);
      process.exit(0);
    }

    const chosen = selected as PreviewFile[];

    if (chosen.length === 0) {
      log.warn('No files selected. Nothing to do.');
      process.exit(0);
    }

    return chosen;
  }

  // ── Default: show preview then confirm ────────────────────────────────────
  const newFiles     = items.filter((i) => i.isNew);
  const changedFiles = items.filter((i) => !i.isNew);

  console.log();

  if (newFiles.length > 0) {
    console.log(chalk.bold.cyan(`  New files (${newFiles.length}):`));
    for (const item of newFiles) {
      console.log(`    ${chalk.cyan('+')} ${chalk.white(item.file.path)} ${chalk.dim(`→ ${item.localPath}`)}`);
    }
    console.log();
  }

  if (changedFiles.length > 0) {
    console.log(chalk.bold.yellow(`  Changed files (${changedFiles.length}):`));
    for (const item of changedFiles) {
      console.log(`    ${chalk.yellow('~')} ${chalk.white(item.file.path)} ${chalk.dim(`→ ${item.localPath}`)}`);
    }
    console.log();
  }

  const confirmed = await p.confirm({
    message: `${verb} ${items.length} file(s)?`,
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel(`${verb} cancelled.`);
    process.exit(0);
  }

  return items;
}
