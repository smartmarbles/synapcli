import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  writeFile, readLocalFile, deleteFile,
  fileExists, isDirWritable, resolveLocalPath,
} from '../utils/files.js';

// ─── Temp directory setup ─────────────────────────────────────────────────────

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `synapcli-files-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ─── writeFile ────────────────────────────────────────────────────────────────

describe('writeFile', () => {
  it('writes content to a file', () => {
    const filePath = join(testDir, 'test.md');
    writeFile(filePath, 'hello world');
    expect(readLocalFile(filePath)).toBe('hello world');
  });

  it('creates parent directories if they do not exist', () => {
    const filePath = join(testDir, 'deep', 'nested', 'dir', 'test.md');
    writeFile(filePath, 'content');
    expect(existsSync(filePath)).toBe(true);
  });

  it('overwrites existing file content', () => {
    const filePath = join(testDir, 'test.md');
    writeFile(filePath, 'original');
    writeFile(filePath, 'updated');
    expect(readLocalFile(filePath)).toBe('updated');
  });

  it('writes empty string', () => {
    const filePath = join(testDir, 'empty.md');
    writeFile(filePath, '');
    expect(readLocalFile(filePath)).toBe('');
  });
});

// ─── readLocalFile ────────────────────────────────────────────────────────────

describe('readLocalFile', () => {
  it('returns file content when file exists', () => {
    const filePath = join(testDir, 'test.md');
    writeFile(filePath, 'hello');
    expect(readLocalFile(filePath)).toBe('hello');
  });

  it('returns null when file does not exist', () => {
    expect(readLocalFile(join(testDir, 'nonexistent.md'))).toBeNull();
  });

  it('reads multiline content correctly', () => {
    const content = 'line1\nline2\nline3';
    const filePath = join(testDir, 'multi.md');
    writeFile(filePath, content);
    expect(readLocalFile(filePath)).toBe(content);
  });
});

// ─── deleteFile ───────────────────────────────────────────────────────────────

describe('deleteFile', () => {
  it('deletes an existing file and returns true', () => {
    const filePath = join(testDir, 'test.md');
    writeFile(filePath, 'content');
    const result = deleteFile(filePath);
    expect(result).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });

  it('returns false when file does not exist', () => {
    const result = deleteFile(join(testDir, 'nonexistent.md'));
    expect(result).toBe(false);
  });
});

// ─── fileExists ───────────────────────────────────────────────────────────────

describe('fileExists', () => {
  it('returns true when file exists', () => {
    const filePath = join(testDir, 'test.md');
    writeFile(filePath, 'content');
    expect(fileExists(filePath)).toBe(true);
  });

  it('returns false when file does not exist', () => {
    expect(fileExists(join(testDir, 'nonexistent.md'))).toBe(false);
  });

  it('returns true for directories', () => {
    expect(fileExists(testDir)).toBe(true);
  });
});

// ─── isDirWritable ────────────────────────────────────────────────────────────

describe('isDirWritable', () => {
  it('returns true for an existing writable directory', () => {
    expect(isDirWritable(testDir)).toBe(true);
  });

  it('returns true for a non-existent path whose parent is writable', () => {
    const nonExistent = join(testDir, 'new-subdir');
    expect(isDirWritable(nonExistent)).toBe(true);
  });
});

// ─── resolveLocalPath ─────────────────────────────────────────────────────────

describe('resolveLocalPath', () => {
  const cwd = '/project';

  it('strips the remoteBase prefix and prepends localOutput', () => {
    const result = resolveLocalPath({
      remotePath: 'agents/summarizer.md',
      remoteBase: 'agents',
      localOutput: 'src/agents',
      cwd,
    });
    expect(result).toBe(join(cwd, 'src/agents', 'summarizer.md'));
  });

  it('handles files at repo root with no remoteBase', () => {
    const result = resolveLocalPath({
      remotePath: 'summarizer.md',
      remoteBase: '',
      localOutput: 'src/agents',
      cwd,
    });
    expect(result).toBe(join(cwd, 'src/agents', 'summarizer.md'));
  });

  it('handles nested remote paths', () => {
    const result = resolveLocalPath({
      remotePath: 'agents/tools/search.md',
      remoteBase: 'agents',
      localOutput: 'src/agents',
      cwd,
    });
    expect(result).toBe(join(cwd, 'src/agents', 'tools/search.md'));
  });

  it('defaults localOutput to . when not provided', () => {
    const result = resolveLocalPath({
      remotePath: 'file.md',
      cwd,
    });
    expect(result).toBe(join(cwd, '.', 'file.md'));
  });

  it('does not strip prefix when remoteBase does not match', () => {
    const result = resolveLocalPath({
      remotePath: 'prompts/system.md',
      remoteBase: 'agents',
      localOutput: 'src',
      cwd,
    });
    expect(result).toBe(join(cwd, 'src', 'prompts/system.md'));
  });
});
