import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@clack/prompts', () => ({
  group:    vi.fn(),
  text:     vi.fn(),
  select:   vi.fn(),
  cancel:   vi.fn(),
  isCancel: vi.fn(() => false),
}));

import * as p from '@clack/prompts';
import { promptSource } from '../lib/sourcePrompt.js';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// Helper to make p.group resolve with a set of fake answers
function mockGroupAnswers(answers: Record<string, unknown>) {
  vi.mocked(p.group).mockImplementation(async (_prompts, _opts) => answers as never);
}

describe('promptSource', () => {
  it('returns a SourceConfig with all fields from prompt answers', async () => {
    mockGroupAnswers({
      repo:               'acme/agents',
      name:               'Agents',
      branch:             'main',
      remotePath:         'agents',
      localOutputPreset:  '.',
      localOutputCustom:  undefined,
    });

    const result = await promptSource(0);

    expect(result.repo).toBe('acme/agents');
    expect(result.name).toBe('Agents');
    expect(result.branch).toBe('main');
    expect(result.remotePath).toBe('agents');
    expect(result.localOutput).toBe('.');
  });

  it('uses custom localOutput when preset is "custom"', async () => {
    mockGroupAnswers({
      repo:               'acme/agents',
      name:               'Agents',
      branch:             'main',
      remotePath:         '',
      localOutputPreset:  'custom',
      localOutputCustom:  'my/custom/path',
    });

    const result = await promptSource(0);

    expect(result.localOutput).toBe('my/custom/path');
  });

  it('defaults localOutput to "." when custom preset chosen but custom value empty', async () => {
    mockGroupAnswers({
      repo:               'acme/agents',
      name:               'Agents',
      branch:             'main',
      remotePath:         '',
      localOutputPreset:  'custom',
      localOutputCustom:  '',
    });

    const result = await promptSource(0);

    expect(result.localOutput).toBe('.');
  });

  it('falls back to repo string when name is empty', async () => {
    mockGroupAnswers({
      repo:               'acme/agents',
      name:               '',
      branch:             'main',
      remotePath:         '',
      localOutputPreset:  '.',
      localOutputCustom:  undefined,
    });

    const result = await promptSource(0);

    expect(result.name).toBe('acme/agents');
  });

  it('normalises GitHub URL to owner/repo format', async () => {
    mockGroupAnswers({
      repo:               'https://github.com/acme/agents',
      name:               'Agents',
      branch:             'main',
      remotePath:         '',
      localOutputPreset:  '.',
      localOutputCustom:  undefined,
    });

    const result = await promptSource(0);

    expect(result.repo).toBe('acme/agents');
  });

  it('works without index argument', async () => {
    mockGroupAnswers({
      repo:               'acme/tools',
      name:               'Tools',
      branch:             'main',
      remotePath:         '',
      localOutputPreset:  '.github',
      localOutputCustom:  undefined,
    });

    const result = await promptSource();

    expect(result.repo).toBe('acme/tools');
    expect(result.localOutput).toBe('.github');
  });

  it('uses the preset value directly for known presets', async () => {
    for (const preset of ['.', '.github', '.claude', '.gemini']) {
      mockGroupAnswers({
        repo:               'acme/agents',
        name:               'Agents',
        branch:             'main',
        remotePath:         '',
        localOutputPreset:  preset,
        localOutputCustom:  undefined,
      });
      const result = await promptSource(0);
      expect(result.localOutput).toBe(preset);
    }
  });
});
