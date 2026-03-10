import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import type { ResolveLocalPathParams } from '../types.js';

/**
 * Write a file to disk, creating parent directories as needed.
 */
export function writeFile(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, content, 'utf8');
}

/**
 * Read a local file, returning null if it doesn't exist.
 */
export function readLocalFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf8');
}

/**
 * Delete a local file. Returns true if deleted, false if it didn't exist.
 */
export function deleteFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  unlinkSync(filePath);
  return true;
}

/**
 * Check whether a file exists at the given path.
 */
export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

/**
 * Resolve the local output path for a remote file path.
 * Strips the configured remote base path prefix and prepends the local output dir.
 *
 * Example:
 *   remotePath:  "agents/summarizer.md"
 *   remoteBase:  "agents"
 *   localOutput: "src/agents"
 *   → result:    "src/agents/summarizer.md"
 */
export function resolveLocalPath({
  remotePath,
  remoteBase = '',
  localOutput = '.',
  cwd = process.cwd(),
}: ResolveLocalPathParams): string {
  let relative = remotePath;

  if (remoteBase && remotePath.startsWith(remoteBase)) {
    relative = remotePath.slice(remoteBase.length).replace(/^\//, '');
  }

  return join(cwd, localOutput, relative);
}
