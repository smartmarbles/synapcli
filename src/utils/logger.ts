import chalk from 'chalk';
import { isCI } from './context.js';
import { ExitCode, type ExitCodeValue } from '../types.js';

export const log = {
  info:    (msg: string): void => { console.log(isCI() ? `[INFO] ${msg}` : `${chalk.cyan('ℹ')} ${msg}`); },
  success: (msg: string): void => { console.log(isCI() ? `[OK] ${msg}`   : `${chalk.green('✔')} ${msg}`); },
  warn:    (msg: string): void => { console.log(isCI() ? `[WARN] ${msg}` : `${chalk.yellow('⚠')} ${msg}`); },
  error:   (msg: string): void => { console.error(isCI() ? `[ERR] ${msg}` : `${chalk.red('✖')} ${msg}`); },
  dim:     (msg: string): void => { console.log(isCI() ? msg : chalk.dim(msg)); },
  title:   (msg: string): void => { console.log(isCI() ? `\n=== ${msg} ===` : `\n${chalk.bold.white(msg)}`); },
  dryRun:  (msg: string): void => { console.log(isCI() ? `[DRY-RUN] ${msg}` : `${chalk.magenta('◌ [dry-run]')} ${msg}`); },
};

/**
 * Print a fatal error and exit with the given code (default: GeneralError).
 */
export function fatal(msg: string, code: ExitCodeValue = ExitCode.GeneralError): never {
  log.error(msg);
  process.exit(code);
}
