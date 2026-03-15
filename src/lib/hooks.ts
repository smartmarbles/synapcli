import { execSync } from 'child_process';
import { log } from '../utils/logger.js';

/**
 * Run the configured postpull hook command, if any.
 * Runs in the current working directory.
 */
export function runPostPullHook(command: string | undefined): void {
  if (!command) return;

  log.info(`Running postpull hook: ${command}`);

  try {
    execSync(command, {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    log.success('Postpull hook completed');
  } catch (err) {
    log.warn(`Postpull hook exited with an error: ${(err as Error).message}`);
  }
}
