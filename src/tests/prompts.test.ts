import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clack/prompts', () => ({
  multiselect: vi.fn(),
  isCancel:    vi.fn(() => false),
}));

import * as p from '@clack/prompts';
import { multiselectWithToggle } from '../utils/prompts.js';

const OPTIONS = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
  { value: 'c', label: 'Option C' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helper to get the sentinel value from the first option in the latest call ─

function capturedSentinel(): unknown {
  const call = vi.mocked(p.multiselect).mock.calls[0]?.[0] as { options: { value: unknown }[] };
  return call?.options[0]?.value;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('multiselectWithToggle', () => {
  describe('sentinel label', () => {
    it('always shows "Select / Deselect All" regardless of initial selection', async () => {
      vi.mocked(p.multiselect).mockResolvedValueOnce(['a']);
      await multiselectWithToggle({ message: 'Pick', options: OPTIONS });
      const call = vi.mocked(p.multiselect).mock.calls[0][0] as { options: { label: string }[] };
      expect(call.options[0].label).toContain('Select / Deselect All');
    });
  });

  describe('sentinel is not in initialValues', () => {
    it('does not include sentinel in the initialValues passed to p.multiselect', async () => {
      vi.mocked(p.multiselect).mockResolvedValueOnce(['a', 'b', 'c']);
      await multiselectWithToggle({ message: 'Pick', options: OPTIONS, initialValues: ['a', 'b', 'c'] });
      const call = vi.mocked(p.multiselect).mock.calls[0][0] as { options: { value: unknown }[]; initialValues: unknown[] };
      const sentinel = call.options[0].value;
      expect(call.initialValues).not.toContain(sentinel);
    });
  });

  describe('normal selection (no sentinel)', () => {
    it('returns the items the user selected', async () => {
      vi.mocked(p.multiselect).mockResolvedValueOnce(['a', 'b']);
      const result = await multiselectWithToggle({ message: 'Pick', options: OPTIONS });
      expect(result).toEqual(['a', 'b']);
    });

    it('passes the message through to p.multiselect', async () => {
      vi.mocked(p.multiselect).mockResolvedValueOnce(['a']);
      await multiselectWithToggle({ message: 'Choose wisely', options: OPTIONS });
      expect(p.multiselect).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Choose wisely' })
      );
    });

    it('passes required through to p.multiselect', async () => {
      vi.mocked(p.multiselect).mockResolvedValueOnce(['a']);
      await multiselectWithToggle({ message: 'Pick', options: OPTIONS, required: true });
      expect(p.multiselect).toHaveBeenCalledWith(
        expect.objectContaining({ required: true })
      );
    });

    it('prepends sentinel so options has one extra entry', async () => {
      vi.mocked(p.multiselect).mockResolvedValueOnce(['a']);
      await multiselectWithToggle({ message: 'Pick', options: OPTIONS });
      const call = vi.mocked(p.multiselect).mock.calls[0][0] as { options: unknown[] };
      expect(call.options).toHaveLength(OPTIONS.length + 1);
    });
  });

  describe('toggle — based on items selected at time of press', () => {
    it('selects all when not all items were selected alongside the sentinel', async () => {
      vi.mocked(p.multiselect).mockImplementationOnce(async (opts) => {
        const sentinel = (opts as { options: { value: unknown }[] }).options[0].value;
        return [sentinel, 'a'] as unknown as string[]; // only 'a' was ticked, not b/c
      });
      const result = await multiselectWithToggle({ message: 'Pick', options: OPTIONS });
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('deselects all when all items were selected alongside the sentinel', async () => {
      vi.mocked(p.multiselect).mockImplementationOnce(async (opts) => {
        const sentinel = (opts as { options: { value: unknown }[] }).options[0].value;
        return [sentinel, 'a', 'b', 'c'] as unknown as string[];
      });
      const result = await multiselectWithToggle({ message: 'Pick', options: OPTIONS });
      expect(result).toEqual([]);
    });

    it('selects all when sentinel is the only item checked', async () => {
      vi.mocked(p.multiselect).mockImplementationOnce(async (opts) => {
        const sentinel = (opts as { options: { value: unknown }[] }).options[0].value;
        return [sentinel] as unknown as string[];
      });
      const result = await multiselectWithToggle({ message: 'Pick', options: OPTIONS });
      expect(result).toEqual(['a', 'b', 'c']);
    });
  });

  describe('cancellation', () => {
    it('propagates the cancel symbol from p.multiselect', async () => {
      const sym = Symbol('cancel');
      vi.mocked(p.multiselect).mockResolvedValueOnce(sym as unknown as string[]);
      const result = await multiselectWithToggle({ message: 'Pick', options: OPTIONS });
      expect(typeof result).toBe('symbol');
    });
  });
});
