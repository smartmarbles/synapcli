import chalk from 'chalk';

export const log = {
  info: (msg) => console.log(chalk.cyan('ℹ'), msg),
  success: (msg) => console.log(chalk.green('✔'), msg),
  warn: (msg) => console.log(chalk.yellow('⚠'), msg),
  error: (msg) => console.error(chalk.red('✖'), msg),
  dim: (msg) => console.log(chalk.dim(msg)),
  title: (msg) => console.log('\n' + chalk.bold.white(msg)),
  dryRun: (msg) => console.log(chalk.magenta('◌ [dry-run]'), msg),
};

/**
 * Print a fatal error and exit with code 1.
 */
export function fatal(msg) {
  log.error(msg);
  process.exit(1);
}
