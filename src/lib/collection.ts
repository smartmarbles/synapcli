import { readFileSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import { fetchFileContent } from '../lib/github.js';
import { CONFIG_FILE } from '../lib/config.js';
import type { SourceConfig, CollectionAsset, CollectionFile } from '../types.js';

/**
 * Determine whether a `--from` value is a GitHub shorthand (org/repo/path),
 * a raw GitHub URL, or a local file path.
 */
export type CollectionOrigin =
  | { type: 'local'; path: string }
  | { type: 'url';   url: string; owner: string; repo: string; path: string; ref: string };

/**
 * Parse a --from value into a structured origin.
 *
 * Supported formats:
 *   - Local file path:     `./react.collection.json` or `C:\collections\react.collection.json`
 *   - Raw GitHub URL:      `https://raw.githubusercontent.com/org/repo/branch/path/file.json`
 *   - GitHub shorthand:    `org/repo/path/to/file.collection.json`  (3+ segments, no protocol)
 */
export function parseCollectionOrigin(from: string, ref: string = 'main'): CollectionOrigin {
  // Raw GitHub URL
  if (from.startsWith('https://')) {
    const match = from.match(
      /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/
    );
    if (match) {
      return { type: 'url', url: from, owner: match[1], repo: match[2], path: match[4], ref: match[3] };
    }
    throw new Error(
      `Unsupported URL format. Use a raw.githubusercontent.com URL or the shorthand "org/repo/path/to/file.json".`
    );
  }

  // GitHub shorthand: org/repo/path — must have 3+ segments and no backslash or drive letter
  const segments = from.split('/');
  if (
    segments.length >= 3
    && !from.includes('\\')
    && !/^[A-Za-z]:/.test(from)
    && !existsSync(from)
  ) {
    const [owner, repo, ...rest] = segments;
    const path = rest.join('/');
    return { type: 'url', url: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`, owner, repo, path, ref };
  }

  // Local file
  return { type: 'local', path: from };
}

// ─── Shared loader ────────────────────────────────────────────────────────────

/**
 * Load raw JSON from a collection origin (local file or GitHub).
 * Returns the raw string and a human-readable origin label.
 */
async function loadRawJson(origin: CollectionOrigin): Promise<{ raw: string; originLabel: string }> {
  if (origin.type === 'local') {
    if (!existsSync(origin.path)) {
      throw new Error(`File not found: ${origin.path}`);
    }
    return { raw: readFileSync(origin.path, 'utf8'), originLabel: origin.path };
  }

  const { content } = await fetchFileContent({
    owner: origin.owner,
    repo: origin.repo,
    path: origin.path,
    ref: origin.ref,
  });
  return { raw: content, originLabel: origin.url };
}

// ─── Source-based collections (register --from) ───────────────────────────────

/**
 * Load and validate sources from a collection/config file.
 * Accepts both `synap.config.json` and `*.collection.json` — any JSON with a `sources[]` array.
 */
export async function loadCollection(
  origin: CollectionOrigin
): Promise<{ sources: SourceConfig[]; originLabel: string }> {
  const { raw, originLabel } = await loadRawJson(origin);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse "${originLabel}" — not valid JSON.`);
  }

  const data = parsed as Record<string, unknown>;
  const sources = data.sources as SourceConfig[] | undefined;

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error(`"${originLabel}" does not contain a valid "sources" array.`);
  }

  // Validate each source has required fields
  for (const [i, s] of sources.entries()) {
    if (!s.repo || typeof s.repo !== 'string') {
      throw new Error(`Source at index ${i} in "${originLabel}" is missing a valid "repo" field.`);
    }
    if (!s.branch || typeof s.branch !== 'string') {
      throw new Error(`Source at index ${i} in "${originLabel}" is missing a valid "branch" field.`);
    }
  }

  return { sources, originLabel };
}

/**
 * Duplicate-detection key for a source.
 * A source is considered a duplicate if the same repo + remotePath + branch exists.
 */
export function sourceKey(s: SourceConfig): string {
  /* v8 ignore start */
  return `${s.repo}::${s.remotePath ?? ''}::${s.branch}`;
  /* v8 ignore stop */
}

export interface DuplicateCheckResult {
  toAdd: SourceConfig[];
  skipped: SourceConfig[];
  nameConflicts: SourceConfig[];
}

/**
 * Check incoming sources against existing sources for duplicates and name conflicts.
 */
export function checkDuplicates(
  incoming: SourceConfig[],
  existing: SourceConfig[],
): DuplicateCheckResult {
  const existingKeys = new Set(existing.map(sourceKey));
  const existingNames = new Set(existing.map((s) => s.name).filter(Boolean));

  const toAdd: SourceConfig[] = [];
  const skipped: SourceConfig[] = [];
  const nameConflicts: SourceConfig[] = [];

  for (const s of incoming) {
    if (existingKeys.has(sourceKey(s))) {
      skipped.push(s);
    } else {
      if (s.name && existingNames.has(s.name)) {
        nameConflicts.push(s);
      }
      toAdd.push(s);
      // Track the key/name so subsequent incoming items also deduplicate against each other
      existingKeys.add(sourceKey(s));
      existingNames.add(s.name);
    }
  }

  return { toAdd, skipped, nameConflicts };
}

/**
 * Create a backup of the current synap.config.json before merging.
 */
export function backupConfig(cwd: string = process.cwd()): string | null {
  const configPath = join(cwd, CONFIG_FILE);
  if (!existsSync(configPath)) return null;
  const backupPath = join(cwd, `${CONFIG_FILE}.bak`);
  copyFileSync(configPath, backupPath);
  return backupPath;
}

// ─── Asset-based collections ──────────────────────────────────────────────────

/**
 * Load and validate an asset-based collection file.
 * Expects a JSON file with `name` (string) and `assets[]` (array of CollectionAsset).
 */
export async function loadAssetCollection(
  origin: CollectionOrigin
): Promise<{ collection: CollectionFile; originLabel: string }> {
  const { raw, originLabel } = await loadRawJson(origin);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse "${originLabel}" — not valid JSON.`);
  }

  const data = parsed as Record<string, unknown>;

  if (!data.name || typeof data.name !== 'string') {
    throw new Error(`"${originLabel}" is missing a valid "name" field.`);
  }

  const assets = data.assets as CollectionAsset[] | undefined;
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error(`"${originLabel}" does not contain a valid "assets" array.`);
  }

  for (const [i, a] of assets.entries()) {
    if (!a.repo || typeof a.repo !== 'string') {
      throw new Error(`Asset at index ${i} in "${originLabel}" is missing a valid "repo" field.`);
    }
    if (!a.branch || typeof a.branch !== 'string') {
      throw new Error(`Asset at index ${i} in "${originLabel}" is missing a valid "branch" field.`);
    }
    if (!a.path || typeof a.path !== 'string') {
      throw new Error(`Asset at index ${i} in "${originLabel}" is missing a valid "path" field.`);
    }
    if (!a.defaultOutput || typeof a.defaultOutput !== 'string') {
      throw new Error(`Asset at index ${i} in "${originLabel}" is missing a valid "defaultOutput" field.`);
    }
  }

  const collection: CollectionFile = {
    name: data.name as string,
    description: typeof data.description === 'string' ? data.description : undefined,
    assets,
  };

  return { collection, originLabel };
}

/**
 * Group assets by their resolved output path for batched prompting.
 */
export function groupByOutput(assets: CollectionAsset[], resolvedOutputs: Map<string, string>): Map<string, CollectionAsset[]> {
  const groups = new Map<string, CollectionAsset[]>();

  for (const asset of assets) {
    const output = resolvedOutputs.get(assetKey(asset)) ?? asset.defaultOutput;
    const group = groups.get(output);
    if (group) {
      group.push(asset);
    } else {
      groups.set(output, [asset]);
    }
  }

  return groups;
}

/**
 * Unique key for a collection asset.
 */
export function assetKey(a: CollectionAsset): string {
  return `${a.repo}::${a.path}`;
}
