import { describe, it, expect, afterEach } from 'vitest';
import { setCI, isCI } from '../utils/context.js';

describe('context', () => {
  afterEach(() => {
    setCI(false);
  });

  it('isCI() returns false by default', () => {
    expect(isCI()).toBe(false);
  });

  it('isCI() returns true after setCI(true)', () => {
    setCI(true);
    expect(isCI()).toBe(true);
  });

  it('isCI() returns false after setCI(false)', () => {
    setCI(true);
    setCI(false);
    expect(isCI()).toBe(false);
  });
});
