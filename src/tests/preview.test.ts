import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setCI } from '../utils/context.js';

vi.mock('@clack/prompts', () => ({
  multiselect: vi.fn(),
  confirm:     vi.fn(),
  isCancel:    vi.fn(() => false),
  cancel:      vi.fn(),
}));

import * as p from '@clack/prompts';
import { previewAndConfirm } from '../lib/preview.js';
import type { PreviewFile, SourceConfig } from '../types.js';

const SOURCE: SourceConfig = {
  name: 'Test', repo: 'acme/agents', branch: 'main', remotePath: '', localOutput: '.',
};

function makeItem(path: string, isNew = true): PreviewFile {
  return {
    file:      { path, sha: 'abc123', size: 100 },
    localPath: `./${path}`,
    isNew,
    source:    SOURCE,
  };
}

afterEach(() => {
  setCI(false);
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('previewAndConfirm', () => {
  it('returns empty array immediately when items list is empty', async () => {
    const result = await previewAndConfirm([], { verb: 'Pull' });
    expect(result).toEqual([]);
    expect(p.confirm).not.toHaveBeenCalled();
  });

  it('returns all items when force=true, no prompts shown', async () => {
    const items = [makeItem('a.md'), makeItem('b.md')];
    const result = await previewAndConfirm(items, { verb: 'Pull', force: true });
    expect(result).toBe(items);
    expect(p.confirm).not.toHaveBeenCalled();
  });

  it('returns all items in CI mode without prompting', async () => {
    setCI(true);
    const items = [makeItem('a.md')];
    const result = await previewAndConfirm(items, { verb: 'Pull' });
    expect(result).toBe(items);
    expect(p.confirm).not.toHaveBeenCalled();
  });

  describe('default (non-interactive) mode', () => {
    beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));

    it('shows new and changed file groups then returns items when confirmed', async () => {
      vi.mocked(p.confirm).mockResolvedValueOnce(true);
      const items = [makeItem('new.md', true), makeItem('changed.md', false)];
      const result = await previewAndConfirm(items, { verb: 'Pull' });
      expect(result).toBe(items);
    });

    it('includes label prefix in confirm message when label is provided', async () => {
      vi.mocked(p.confirm).mockResolvedValueOnce(true);
      const items = [makeItem('a.md', true)];
      await previewAndConfirm(items, { verb: 'Pull', label: 'myrepo' });
      expect(p.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('[myrepo]') })
      );
    });

    it('includes source counter in confirm message when totalSources > 1', async () => {
      vi.mocked(p.confirm).mockResolvedValueOnce(true);
      const items = [makeItem('a.md', true)];
      await previewAndConfirm(items, { verb: 'Pull', label: 'myrepo', sourceIndex: 2, totalSources: 3 });
      expect(p.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('(2/3)') })
      );
    });

    it('shows only new files section when all items are new', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.mocked(p.confirm).mockResolvedValueOnce(true);
      await previewAndConfirm([makeItem('a.md', true)], { verb: 'Pull' });
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('New files');
    });

    it('shows only changed files section when no items are new', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.mocked(p.confirm).mockResolvedValueOnce(true);
      await previewAndConfirm([makeItem('a.md', false)], { verb: 'Update' });
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Changed files');
    });

    it('exits when user declines confirmation', async () => {
      vi.mocked(p.confirm).mockResolvedValueOnce(false);
      vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
        throw new Error(`exit:${code ?? 0}`);
      });
      await expect(
        previewAndConfirm([makeItem('a.md')], { verb: 'Pull' })
      ).rejects.toThrow('exit:0');
    });

    it('exits when confirm prompt is cancelled', async () => {
      vi.mocked(p.isCancel).mockReturnValueOnce(true);
      vi.mocked(p.confirm).mockResolvedValueOnce(Symbol('cancel') as unknown as boolean);
      vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
        throw new Error(`exit:${code ?? 0}`);
      });
      await expect(
        previewAndConfirm([makeItem('a.md')], { verb: 'Pull' })
      ).rejects.toThrow('exit:0');
    });
  });

  describe('interactive mode', () => {
    beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));

    it('returns the subset of files chosen in multiselect', async () => {
      const items = [makeItem('a.md'), makeItem('b.md')];
      vi.mocked(p.multiselect).mockResolvedValueOnce([items[0]]);
      const result = await previewAndConfirm(items, { verb: 'Pull', interactive: true });
      expect(result).toEqual([items[0]]);
    });

    it('includes label prefix in multiselect message when label is provided', async () => {
      const items = [makeItem('a.md')];
      vi.mocked(p.multiselect).mockResolvedValueOnce(items);
      await previewAndConfirm(items, { verb: 'Pull', interactive: true, label: 'myrepo' });
      expect(p.multiselect).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('[myrepo]') })
      );
    });

    it('includes source counter in multiselect message when totalSources > 1', async () => {
      const items = [makeItem('a.md')];
      vi.mocked(p.multiselect).mockResolvedValueOnce(items);
      await previewAndConfirm(items, { verb: 'Pull', interactive: true, label: 'myrepo', sourceIndex: 1, totalSources: 3 });
      expect(p.multiselect).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('(1/3)') })
      );
    });

    it('returns null when multiselect is cancelled', async () => {
      vi.mocked(p.isCancel).mockReturnValueOnce(true);
      vi.mocked(p.multiselect).mockResolvedValueOnce(Symbol('cancel') as unknown as PreviewFile[]);
      const result = await previewAndConfirm([makeItem('a.md')], { verb: 'Pull', interactive: true });
      expect(result).toBeNull();
      expect(p.cancel).toHaveBeenCalled();
    });

    it('returns empty array when no files are selected', async () => {
      vi.mocked(p.multiselect).mockResolvedValueOnce([]);
      const result = await previewAndConfirm([makeItem('a.md')], { verb: 'Pull', interactive: true });
      expect(result).toEqual([]);
    });

    it('returns empty array when "Deselect all" sentinel is triggered', async () => {
      const items = [makeItem('a.md'), makeItem('b.md')];
      vi.mocked(p.multiselect).mockImplementationOnce(async (opts) => {
        const sentinel = (opts as { options: { value: unknown }[] }).options[0].value;
        return [sentinel, ...items] as unknown as PreviewFile[];
      });
      const result = await previewAndConfirm(items, { verb: 'Pull', interactive: true });
      expect(result).toEqual([]);
    });
  });
});
