import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const MARKER   = '# SynapCLI';
const CACHE_DIR = join(homedir(), '.synap');

function removeFromFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false;

  const content = readFileSync(filePath, 'utf8');
  if (!content.includes(MARKER)) return false;

  const lines    = content.split('\n');
  const startIdx = lines.findIndex((l) => l.includes(MARKER));
  if (startIdx === -1) return false;

  let depth  = 0;
  let endIdx = startIdx;

  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }
    endIdx = i;
    if (depth === 0 && i > startIdx) break;
  }

  const before  = lines.slice(0, startIdx).join('\n').trimEnd();
  const after   = lines.slice(endIdx + 1).join('\n').trimStart();
  const updated = before + (after ? '\n\n' + after : '\n');

  writeFileSync(filePath, updated, 'utf8');
  return true;
}

function getPowerShellProfile(): string {
  try {
    /* v8 ignore next 3 */
    const cmd = process.platform === 'win32'
      ? 'powershell -NoProfile -Command "$PROFILE"'
      : 'pwsh -NoProfile -Command "$PROFILE"';
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch {
    return join(homedir(), 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1');
  }
}

export function runUninstall(): void {
  const profiles = [
    join(homedir(), '.bashrc'),
    join(homedir(), '.zshrc'),
    join(homedir(), '.config', 'fish', 'config.fish'),
    getPowerShellProfile(),
  ];

  let removed = false;

  for (const profile of profiles) {
    try {
      if (removeFromFile(profile)) {
        console.log(`Removed SynapCLI completion from ${profile}`);
        removed = true;
      }
    } catch /* v8 ignore next */ {
      // Best-effort — never block uninstall
    }
  }

  if (!removed) {
    console.log('No SynapCLI completion scripts found to remove.');
  }

  // ── Remove ~/.synap cache directory ───────────────────────────────────────
  try {
    if (existsSync(CACHE_DIR)) {
      rmSync(CACHE_DIR, { recursive: true, force: true });
      console.log(`Removed SynapCLI cache directory ${CACHE_DIR}`);
    }
  } catch /* v8 ignore next */ {
    // Best-effort — never block uninstall
  }
}
