import {
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  unlinkSync,
  accessSync,
  constants,
} from 'fs';
import { dirname, join } from 'path';
import type { ResolveLocalPathParams } from '../types.js';

export function writeFile(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, content, 'utf8');
}

export function readLocalFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf8');
}

export function deleteFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  unlinkSync(filePath);
  return true;
}

export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

/**
 * Check if a directory is writable by the current process.
 */
export function isDirWritable(dirPath: string): boolean {
  try {
    // If it doesn't exist yet, check its nearest existing ancestor
    let check = dirPath;
    while (!existsSync(check)) {
      check = dirname(check);
    }
    accessSync(check, constants.W_OK);
    return true;
  } catch {
    /* v8 ignore next */
    return false;
  }
}

/**
 * Resolve the local output path for a remote file path.
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
