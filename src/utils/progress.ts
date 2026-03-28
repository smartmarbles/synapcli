import cliProgress from 'cli-progress';
import chalk from 'chalk';
import { isCI } from './context.js';
import { log } from './logger.js';

/**
 * A progress bar that degrades gracefully in CI mode.
 * In CI, each file is logged individually instead.
 */
export class SynapProgress {
  private bar?: cliProgress.SingleBar;
  private total: number;
  private current = 0;

  constructor(total: number, label = 'files') {
    this.total = total;

    if (!isCI() && total > 1) {
      this.bar = new cliProgress.SingleBar(
        {
          format: `  ${chalk.cyan('{bar}')} {percentage}% | {value}/{total} ${label} | {file}`,
          barCompleteChar: '█',
          barIncompleteChar: '░',
          hideCursor: true,
          clearOnComplete: false,
        },
        cliProgress.Presets.shades_classic
      );
      this.bar.start(total, 0, { file: '' });
    }
  }

  tick(filename: string): void {
    this.current++;
    if (this.bar) {
      this.bar.update(this.current, { file: chalk.dim(filename) });
    /* v8 ignore start */
    } else if (isCI()) {
      log.info(`[${this.current}/${this.total}] ${filename}`);
    }
    /* v8 ignore stop */
  }

  stop(): void {
    this.bar?.stop();
  }
}
