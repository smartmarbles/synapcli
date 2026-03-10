import chalk from 'chalk';

export const log = {
  info:    (msg: string): void => { console.log(chalk.cyan('ℹ'), msg); },
  success: (msg: string): void => { console.log(chalk.green('✔'), msg); },
  warn:    (msg: string): void => { console.log(chalk.yellow('⚠'), msg); },
  error:   (msg: string): void => { console.error(chalk.red('✖'), msg); },
  dim:     (msg: string): void => { console.log(chalk.dim(msg)); },
  title:   (msg: string): void => { console.log('\n' + chalk.bold.white(msg)); },
  dryRun:  (msg: string): void => { console.log(chalk.magenta('◌ [dry-run]'), msg); },
};

/**
 * Print a fatal error message and exit with code 1.
 */
export function fatal(msg: string): never {
  log.error(msg);
  process.exit(1);
}
