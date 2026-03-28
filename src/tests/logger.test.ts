import { describe, it, expect, vi, afterEach } from 'vitest';
import { setCI } from '../utils/context.js';
import { log, fatal } from '../utils/logger.js';

afterEach(() => {
  setCI(false);
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('logger — non-CI mode', () => {
  it('log.info uses chalk icon prefix', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('hello');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('hello'));
    expect(spy.mock.calls[0][0]).not.toContain('[INFO]');
  });

  it('log.success uses chalk icon prefix', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.success('all good');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('all good'));
    expect(spy.mock.calls[0][0]).not.toContain('[OK]');
  });

  it('log.warn uses chalk icon prefix', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.warn('heads up');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('heads up'));
  });

  it('log.error writes to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.error('oops');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('oops'));
  });

  it('log.dim outputs the message', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.dim('dimmed');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('dimmed'));
  });

  it('log.title outputs the message', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.title('Section');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Section'));
  });

  it('log.dryRun outputs the message', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.dryRun('would delete');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('would delete'));
  });
});

describe('logger — CI mode', () => {
  it('log.info uses [INFO] prefix in CI mode', () => {
    setCI(true);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('hello');
    expect(spy).toHaveBeenCalledWith('[INFO] hello');
  });

  it('log.success uses [OK] prefix in CI mode', () => {
    setCI(true);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.success('all good');
    expect(spy).toHaveBeenCalledWith('[OK] all good');
  });

  it('log.warn uses [WARN] prefix in CI mode', () => {
    setCI(true);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.warn('heads up');
    expect(spy).toHaveBeenCalledWith('[WARN] heads up');
  });

  it('log.error uses [ERR] prefix in CI mode', () => {
    setCI(true);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.error('oops');
    expect(spy).toHaveBeenCalledWith('[ERR] oops');
  });

  it('log.dim outputs plain message in CI mode', () => {
    setCI(true);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.dim('dimmed text');
    expect(spy).toHaveBeenCalledWith('dimmed text');
  });

  it('log.title uses === prefix in CI mode', () => {
    setCI(true);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.title('Section');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('=== Section ==='));
  });

  it('log.dryRun uses [DRY-RUN] prefix in CI mode', () => {
    setCI(true);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.dryRun('would delete');
    expect(spy).toHaveBeenCalledWith('[DRY-RUN] would delete');
  });
});

describe('fatal', () => {
  it('logs error and sets process.exitCode', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => fatal('something broke', 2)).toThrow('exit:2');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('something broke'));
    expect(process.exitCode).toBe(2);
  });

  it('defaults to exit code 1 when no code given', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => fatal('broken')).toThrow('exit:1');
    expect(process.exitCode).toBe(1);
  });
});
