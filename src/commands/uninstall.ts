import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const MARKER = '# SynapCLI';
const CACHE_DIR = join(homedir(), '.synap');

/**
 * Remove the SynapCLI completion block from a shell config file.
 * Looks for the # SynapCLI marker and removes everything from that
 * line to the closing } of the last block.
 */
function removeFromFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false;

  const content = readFileSync(filePath, 'utf8');
  if (!content.includes(MARKER)) return false;

  // Split into lines and find the start of the SynapCLI block
  const lines = content.split('\n');
  const startIdx = lines.findIndex((l) => l.includes(MARKER));
  if (startIdx === -1) return false;

  // Walk forward to find the end — the last closing } followed by
  // either EOF or a blank line after the block
  let depth = 0;
  let endIdx = startIdx;

  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }
    endIdx = i;
    // Once we've seen at least one brace pair close, and depth is back to 0,
    // we've found the end of the last block
    if (depth === 0 && i > startIdx) break;
  }

  // Remove the block plus any surrounding blank lines
  const before = lines.slice(0, startIdx).join('\n').trimEnd();
  const after  = lines.slice(endIdx + 1).join('\n').trimStart();

  const updated = before + (after ? '\n\n' + after : '\n');
  writeFileSync(filePath, updated, 'utf8');
  return true;
}

function getPowerShellProfile(): string {
  try {
    const cmd = process.platform === 'win32'
      ? 'powershell -NoProfile -Command "$PROFILE"'
      : 'pwsh -NoProfile -Command "$PROFILE"';
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch {
    return join(homedir(), 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1');
  }
}

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
  } catch {
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
} catch {
  // Best-effort — never block uninstall
}
