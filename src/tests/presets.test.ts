import { describe, it, expect } from 'vitest';
import { PRESET_OPTIONS, isValidPreset, applyPreset } from '../lib/presets.js';
import type { PresetOption } from '../lib/presets.js';

// ─── PRESET_OPTIONS ───────────────────────────────────────────────────────────

describe('PRESET_OPTIONS', () => {
  it('contains all five presets', () => {
    const values = PRESET_OPTIONS.map((o: PresetOption) => o.value);
    expect(values).toEqual(['copilot', 'claude', 'gemini', 'codex', 'none']);
  });
});

// ─── isValidPreset ────────────────────────────────────────────────────────────

describe('isValidPreset', () => {
  it('returns true for all defined presets', () => {
    for (const name of ['copilot', 'claude', 'gemini', 'codex', 'none']) {
      expect(isValidPreset(name)).toBe(true);
    }
  });

  it('returns false for unknown names', () => {
    expect(isValidPreset('unknown')).toBe(false);
    expect(isValidPreset('')).toBe(false);
  });
});

// ─── applyPreset ──────────────────────────────────────────────────────────────

describe('applyPreset', () => {
  // ── copilot (no-op) ──

  it('copilot: passes everything through unchanged', () => {
    expect(applyPreset('copilot', '.github/skills')).toBe('.github/skills');
    expect(applyPreset('copilot', '.github/instructions')).toBe('.github/instructions');
    expect(applyPreset('copilot', 'scripts')).toBe('scripts');
  });

  // ── claude (prefix swap .github → .claude) ──

  it('claude: swaps .github prefix', () => {
    expect(applyPreset('claude', '.github/skills')).toBe('.claude/skills');
    expect(applyPreset('claude', '.github/instructions')).toBe('.claude/instructions');
    expect(applyPreset('claude', '.github/agents')).toBe('.claude/agents');
  });

  it('claude: exact match for .github', () => {
    expect(applyPreset('claude', '.github')).toBe('.claude');
  });

  it('claude: passes through non-matching paths', () => {
    expect(applyPreset('claude', 'scripts')).toBe('scripts');
    expect(applyPreset('claude', 'src/utils')).toBe('src/utils');
  });

  // ── gemini (prefix swap .github → .gemini) ──

  it('gemini: swaps .github prefix', () => {
    expect(applyPreset('gemini', '.github/skills')).toBe('.gemini/skills');
    expect(applyPreset('gemini', '.github/instructions')).toBe('.gemini/instructions');
  });

  it('gemini: passes through non-matching paths', () => {
    expect(applyPreset('gemini', 'scripts')).toBe('scripts');
  });

  // ── codex (explicit mappings) ──

  it('codex: exact match for .github/skills', () => {
    expect(applyPreset('codex', '.github/skills')).toBe('.agents/skills');
  });

  it('codex: exact match for .github/instructions', () => {
    expect(applyPreset('codex', '.github/instructions')).toBe('.');
  });

  it('codex: exact match for .github/agents', () => {
    expect(applyPreset('codex', '.github/agents')).toBe('.agents/skills');
  });

  it('codex: exact match for .github/prompts', () => {
    expect(applyPreset('codex', '.github/prompts')).toBe('.');
  });

  it('codex: prefix match with dot replacement strips leading slash', () => {
    // .github/prompts/react maps via prefix .github/prompts → . → strip leading /
    expect(applyPreset('codex', '.github/prompts/react')).toBe('react');
  });

  it('codex: prefix match for nested paths under .github/skills', () => {
    expect(applyPreset('codex', '.github/skills/react')).toBe('.agents/skills/react');
  });

  it('codex: longest prefix wins — .github/skills over .github', () => {
    // .github/skills/deep should match .github/skills (→ .agents/skills), not .github (→ .agents)
    expect(applyPreset('codex', '.github/skills/deep/nested')).toBe('.agents/skills/deep/nested');
  });

  it('codex: fallback to .github prefix for unmatched sub-paths', () => {
    expect(applyPreset('codex', '.github/other')).toBe('.agents/other');
  });

  it('codex: passes through non-matching paths', () => {
    expect(applyPreset('codex', 'scripts')).toBe('scripts');
  });

  // ── none (no-op) ──

  it('none: passes everything through unchanged', () => {
    expect(applyPreset('none', '.github/skills')).toBe('.github/skills');
    expect(applyPreset('none', 'scripts')).toBe('scripts');
  });

  // ── unknown preset ──

  it('returns original path for unknown preset', () => {
    expect(applyPreset('bogus', '.github/skills')).toBe('.github/skills');
  });
});
