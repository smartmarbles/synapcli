import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Write a file to disk, creating parent directories as needed.
 */
export function writeFile(filePath, content) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, content, 'utf8');
}

/**
 * Read a local file, returning null if it doesn't exist.
 */
export function readLocalFile(filePath) {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf8');
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
export function resolveLocalPath({ remotePath, remoteBase = '', localOutput = '.', cwd = process.cwd() }) {
  let relative = remotePath;

  if (remoteBase && remotePath.startsWith(remoteBase)) {
    relative = remotePath.slice(remoteBase.length).replace(/^\//, '');
  }

  return join(cwd, localOutput, relative);
}
