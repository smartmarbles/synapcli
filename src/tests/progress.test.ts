import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setCI } from '../utils/context.js';

// Mock cli-progress to avoid TTY-dependent rendering in tests
vi.mock('cli-progress', () => ({
  default: {
    // Use a regular function (not arrow) so it can be called with `new`
    SingleBar: vi.fn(function(this: Record<string, unknown>) {
      this.start  = vi.fn().mockReturnThis();
      this.update = vi.fn();
      this.stop   = vi.fn();
    }),
    Presets: { shades_classic: {} },
  },
}));

import cliProgress from 'cli-progress';
import { SynapProgress } from '../utils/progress.js';

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setCI(false);
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('SynapProgress', () => {
  describe('non-CI mode', () => {
    it('creates a SingleBar when total > 1', () => {
      new SynapProgress(5, 'files');
      expect(cliProgress.SingleBar).toHaveBeenCalledTimes(1);
    });

    it('does not create a bar when total === 1', () => {
      new SynapProgress(1, 'files');
      expect(cliProgress.SingleBar).not.toHaveBeenCalled();
    });

    it('tick calls bar.update with filename when bar exists', () => {
      const progress = new SynapProgress(3, 'files');
      const barInstance = vi.mocked(cliProgress.SingleBar).mock.instances[0] as unknown as { update: ReturnType<typeof vi.fn> };
      progress.tick('agent.md');
      expect(barInstance.update).toHaveBeenCalledWith(1, { file: expect.stringContaining('agent.md') });
    });

    it('tick does not log to console when bar exists', () => {
      const progress = new SynapProgress(3, 'files');
      progress.tick('agent.md');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('stop calls bar.stop when bar exists', () => {
      const progress = new SynapProgress(3, 'files');
      const barInstance = vi.mocked(cliProgress.SingleBar).mock.instances[0] as unknown as { stop: ReturnType<typeof vi.fn> };
      progress.stop();
      expect(barInstance.stop).toHaveBeenCalled();
    });

    it('stop does not throw when no bar (total === 1)', () => {
      const progress = new SynapProgress(1, 'files');
      expect(() => progress.stop()).not.toThrow();
    });
  });

  describe('CI mode', () => {
    beforeEach(() => setCI(true));

    it('never creates a SingleBar in CI mode', () => {
      new SynapProgress(5, 'files');
      expect(cliProgress.SingleBar).not.toHaveBeenCalled();
    });

    it('tick logs [current/total] filename to console in CI mode', () => {
      const progress = new SynapProgress(3, 'files');
      progress.tick('file1.md');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[1/3]'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('file1.md'));
    });

    it('tick increments counter correctly across multiple calls', () => {
      const progress = new SynapProgress(3, 'files');
      progress.tick('a.md');
      progress.tick('b.md');
      const calls = consoleSpy.mock.calls.map((c) => c[0]);
      expect(calls[0]).toContain('[1/3]');
      expect(calls[1]).toContain('[2/3]');
    });

    it('stop does not throw in CI mode', () => {
      const progress = new SynapProgress(3, 'files');
      expect(() => progress.stop()).not.toThrow();
    });
  });
});
