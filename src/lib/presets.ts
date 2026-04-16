/**
 * Development system presets for collection installs.
 *
 * Each preset maps a known defaultOutput prefix to the equivalent path
 * for that system. Prefix swaps handle most systems (Copilot → Claude).
 * Systems with non-standard layouts (Codex) get explicit path mappings.
 *
 * Longest-prefix match wins so `.github/skills` takes priority over `.github`
 * when both exist.
 */

export interface PresetOption {
  value: string;
  label: string;
  hint: string;
}

export const PRESET_OPTIONS: PresetOption[] = [
  { value: 'copilot', label: 'GitHub Copilot',     hint: '.github/' },
  { value: 'claude',  label: 'Claude Code',         hint: '.claude/' },
  { value: 'gemini',  label: 'Gemini Code Assist',  hint: '.gemini/' },
  { value: 'codex',   label: 'OpenAI Codex',        hint: '.agents/' },
  { value: 'none',    label: 'Other / no remapping', hint: '' },
];

/**
 * Preset path mappings. Keys are the prefix (or exact path) to match against
 * the creator's `defaultOutput`. Values are the replacement.
 *
 * - Empty object = no remapping (creator's defaults are already correct)
 * - Prefix entries like `'.github': '.claude'` swap that prefix
 * - Exact entries like `'.github/instructions': '.'` take priority over prefix
 */
const PRESETS: Record<string, Record<string, string>> = {
  copilot: {},
  claude: {
    '.github': '.claude',
  },
  gemini: {
    '.github': '.gemini',
  },
  codex: {
    '.github/skills':       '.agents/skills',
    '.github/instructions': '.',
    '.github/agents':       '.agents/skills',
    '.github/prompts':      '.',
    '.github':              '.agents',
  },
  none: {},
};

/**
 * Check whether a preset name is valid.
 */
export function isValidPreset(name: string): boolean {
  return name in PRESETS;
}

/**
 * Apply a preset to a single defaultOutput path.
 *
 * Resolution:
 * 1. Exact match → return the mapped value
 * 2. Longest prefix match → swap the prefix portion
 * 3. No match → return the original path unchanged
 */
export function applyPreset(preset: string, defaultOutput: string): string {
  const map = PRESETS[preset];
  if (!map) return defaultOutput;

  // Exact match first
  if (defaultOutput in map) {
    return map[defaultOutput];
  }

  // Longest prefix match
  let bestMatch = '';
  for (const prefix of Object.keys(map)) {
    if (defaultOutput.startsWith(prefix + '/') && prefix.length > bestMatch.length) {
      bestMatch = prefix;
    }
  }

  if (bestMatch) {
    const suffix = defaultOutput.slice(bestMatch.length);
    const replacement = map[bestMatch];
    return replacement === '.' ? suffix.slice(1) : replacement + suffix;
  }

  return defaultOutput;
}
