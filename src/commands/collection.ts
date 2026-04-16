import { writeFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import {
  loadConfig, loadLock, resolvedSources,
} from '../lib/config.js';
import { log, fatal } from '../utils/logger.js';
import { isCI } from '../utils/context.js';
import { ExitCode } from '../types.js';
import type { CollectionAsset, CollectionFile, LockFile } from '../types.js';

export interface CollectionCreateOptions {
  json?: boolean;
}

/** Lockfile key prefixes that are not real file entries */
const INTERNAL_PREFIXES = ['_collection::', '__failed__'];

function isFileEntry(key: string): boolean {
  return !INTERNAL_PREFIXES.some((prefix) => key.includes(prefix));
}

/**
 * Build a list of selectable assets from the lockfile, enriched with
 * defaultOutput from the matching config source.
 */
export function buildAssetList(
  lock: LockFile,
  sources: { repo: string; localOutput: string }[],
): { key: string; asset: CollectionAsset }[] {
  const outputByRepo = new Map<string, string>();
  for (const s of sources) {
    if (!outputByRepo.has(s.repo)) {
      outputByRepo.set(s.repo, s.localOutput);
    }
  }

  const items: { key: string; asset: CollectionAsset }[] = [];

  for (const [key, entry] of Object.entries(lock)) {
    if (!isFileEntry(key)) continue;

    const sepIdx = key.indexOf('::');
    if (sepIdx === -1) continue;

    const repo = key.slice(0, sepIdx);
    const path = key.slice(sepIdx + 2);
    const defaultOutput = outputByRepo.get(repo) ?? '.';

    items.push({
      key,
      asset: { repo, branch: entry.ref, path, defaultOutput },
    });
  }

  return items;
}

export async function collectionCreateCommand(
  name: string,
  options: CollectionCreateOptions = {},
): Promise<void> {
  if (isCI() && !options.json) {
    fatal('synap collection create requires --json in CI mode.', ExitCode.ConfigError);
  }

  // ── Load data ───────────────────────────────────────────────────────────
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal((err as Error).message, ExitCode.ConfigError);
  }

  const lock = loadLock();
  const sources = resolvedSources(config!);
  const items = buildAssetList(lock, sources);

  if (items.length === 0) {
    fatal('No tracked files found in synap.lock.json. Pull some files first.', ExitCode.ConfigError);
  }

  // ── JSON mode (non-interactive) ─────────────────────────────────────────
  if (options.json) {
    const collection: CollectionFile = {
      name,
      assets: items.map((i) => i.asset),
    };
    console.log(JSON.stringify(collection, null, 2));
    return;
  }

  // ── Interactive mode ────────────────────────────────────────────────────
  p.intro(chalk.bold.cyan('  SynapCLI — Create Collection  '));

  const selected = await p.multiselect({
    message: 'Select files to include',
    options: items.map((i) => ({
      value: i.key,
      label: `${chalk.white(i.key)} ${chalk.dim('→ ' + i.asset.defaultOutput)}`,
    })),
    required: true,
  });

  /* v8 ignore start */
  if (p.isCancel(selected)) {
    p.cancel('Collection creation cancelled.');
    process.exit(0);
  }
  /* v8 ignore stop */

  const selectedKeys = new Set(selected as string[]);
  const selectedAssets = items
    .filter((i) => selectedKeys.has(i.key))
    .map((i) => i.asset);

  // ── Prompt for display name ─────────────────────────────────────────────
  const displayName = await p.text({
    message: 'Collection name',
    defaultValue: name,
    placeholder: name,
  });

  /* v8 ignore start */
  if (p.isCancel(displayName)) {
    p.cancel('Collection creation cancelled.');
    process.exit(0);
  }
  /* v8 ignore stop */

  const resolvedName = (displayName as string) || name;

  // ── Prompt for description ──────────────────────────────────────────────
  const description = await p.text({
    message: 'Description (optional)',
    defaultValue: '',
    placeholder: 'A short description of this collection',
  });

  /* v8 ignore start */
  if (p.isCancel(description)) {
    p.cancel('Collection creation cancelled.');
    process.exit(0);
  }
  /* v8 ignore stop */

  // ── Build + write collection ────────────────────────────────────────────
  const collection: CollectionFile = {
    name: resolvedName,
    ...(description ? { description: description as string } : {}),
    assets: selectedAssets,
  };

  const filename = `${name}.collection.json`;
  const filePath = join(process.cwd(), filename);
  writeFileSync(filePath, JSON.stringify(collection, null, 2) + '\n', 'utf8');

  console.log();
  log.success(`Wrote ${filename} (${selectedAssets.length} asset${selectedAssets.length > 1 ? 's' : ''})`);
  p.outro(chalk.green('Collection created'));
}
