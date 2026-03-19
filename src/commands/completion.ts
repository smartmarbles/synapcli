import chalk from 'chalk';
import * as p from '@clack/prompts';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { log } from '../utils/logger.js';

// ─── Shell scripts ────────────────────────────────────────────────────────────

const SCRIPTS: Record<string, string> = {
  bash: `
# SynapCLI bash completion
_synap_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local cmd="\${COMP_WORDS[1]}"

  case "$cmd" in
    pull|update|diff|delete)
      local files
      files=$(synap --get-completions "$cur" 2>/dev/null)
      COMPREPLY=($(compgen -W "$files" -- "$cur"))
      ;;
    *)
      COMPREPLY=($(compgen -W "init pull list status diff update delete doctor completion" -- "$cur"))
      ;;
  esac
}
complete -F _synap_completions synap
`.trim(),

  zsh: `
# SynapCLI zsh completion
_synap() {
  local cmd="\${words[2]}"

  case "$cmd" in
    pull|update|diff|delete)
      local -a files
      files=($(synap --get-completions "\${words[-1]}" 2>/dev/null))
      compadd -a files
      ;;
    *)
      local -a cmds
      cmds=(
        'init:Bootstrap SynapCLI config for this project'
        'pull:Fetch agent/prompt files from the remote repo'
        'list:List available files in the remote repo'
        'status:Show sync status of all tracked files'
        'diff:Show what has changed upstream vs local'
        'update:Pull only files that have changed upstream'
        'delete:Delete tracked files from disk'
        'doctor:Validate your setup'
        'completion:Output or install shell tab completion'
      )
      _describe 'command' cmds
      ;;
  esac
}
compdef _synap synap
`.trim(),

  fish: `
# SynapCLI fish completion
function __synap_file_completions
    set -l cmd (commandline -opc)[2]
    if contains -- $cmd pull update diff delete
        synap --get-completions (commandline -ct) 2>/dev/null
    end
end

# Subcommands
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion' \\
  -a 'init'       -d 'Bootstrap SynapCLI config'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion' \\
  -a 'pull'       -d 'Fetch files from remote repo'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion' \\
  -a 'list'       -d 'List available files'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion' \\
  -a 'status'     -d 'Show sync status'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion' \\
  -a 'diff'       -d 'Show upstream changes'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion' \\
  -a 'update'     -d 'Pull only changed files'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion' \\
  -a 'delete'     -d 'Delete tracked files'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion' \\
  -a 'doctor'     -d 'Validate your setup'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion' \\
  -a 'completion' -d 'Install shell completion'

# Dynamic file name completions
complete -c synap -f -n '__fish_seen_subcommand_from pull update diff delete' \\
  -a '(__synap_file_completions)'
`.trim(),

  powershell: `
# SynapCLI PowerShell completion (compatible with PS 5.1 and PS 7)
function _SynapGetCompletions {
  param([string]$wordToComplete)
  $cacheFile = Join-Path (Join-Path $env:USERPROFILE '.synap') 'completions.json'
  if (-not (Test-Path $cacheFile)) { return @() }
  try {
    $json  = Get-Content $cacheFile -Raw | ConvertFrom-Json
    $cwd   = (Get-Location).Path
    $entry = $json.PSObject.Properties.Item($cwd)
    if (-not $entry) { return @() }
    $cachedAt = [datetime]::Parse($entry.Value.cachedAt).ToUniversalTime()
    if (([datetime]::UtcNow - $cachedAt).TotalMinutes -gt 10) { return @() }
    $lower = $wordToComplete.ToLower()
    return $entry.Value.files | Where-Object {
      $filename = ($_ -split '/')[-1]
      $_.ToLower().Contains($lower) -or $filename.ToLower().StartsWith($lower)
    }
  } catch {
    return @()
  }
}

if ($PSVersionTable.PSVersion.Major -ge 7) {
  Register-ArgumentCompleter -Native -CommandName synap -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $tokens = $commandAst.ToString() -split '\\s+'
    $cmd = if ($tokens.Count -gt 1) { $tokens[1] } else { '' }
    if ($cmd -in @('pull', 'update', 'diff', 'delete')) {
      _SynapGetCompletions $wordToComplete | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
      }
    } else {
      @('init','pull','list','status','diff','update','delete','doctor','completion','register','deregister') |
        Where-Object { $_ -like "$wordToComplete*" } |
        ForEach-Object {
          [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
    }
  }
} else {
  $global:_synapOriginalTabExpansion2 = $function:TabExpansion2
  function global:TabExpansion2 {
    param($inputScript, $cursorColumn, $options)
    $tokens = $inputScript.TrimStart() -split '\\s+'
    if ($tokens[0] -eq 'synap' -and $tokens.Count -ge 2) {
      $wordToComplete = if ($inputScript.EndsWith(' ')) { '' } else { $tokens[-1] }
      $results = _SynapGetCompletions $wordToComplete
      if ($results) {
        $col = [System.Collections.ObjectModel.Collection[System.Management.Automation.CompletionResult]]::new()
        $results | ForEach-Object { $col.Add([System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)) }
        $replStart = $cursorColumn - $wordToComplete.Length
        return [System.Management.Automation.CommandCompletion]::new($col, -1, $replStart, $wordToComplete.Length)
      }
      $empty = [System.Collections.ObjectModel.Collection[System.Management.Automation.CompletionResult]]::new()
      return [System.Management.Automation.CommandCompletion]::new($empty, -1, $cursorColumn, 0)
    }
    if ($global:_synapOriginalTabExpansion2) {
      return & $global:_synapOriginalTabExpansion2 $inputScript $cursorColumn $options
    }
    return [System.Management.Automation.CommandCompletion]::new(
      [System.Collections.ObjectModel.Collection[System.Management.Automation.CompletionResult]]::new(),
      -1, $cursorColumn, 0
    )
  }
}
`.trim(),
};

// ─── Shell config file paths ──────────────────────────────────────────────────

const SHELL_CONFIG: Record<string, string> = {
  bash:       join(homedir(), '.bashrc'),
  zsh:        join(homedir(), '.zshrc'),
  fish:       join(homedir(), '.config', 'fish', 'config.fish'),
  powershell: '',  // resolved dynamically
};

function getPowerShellProfile(): string {
  try {
    // Try pwsh (PS7) first, fall back to powershell (PS5.1)
    /* v8 ignore next 3 */
    const cmd = process.platform === 'win32'
      ? 'powershell -NoProfile -Command "$PROFILE"'
      : 'pwsh -NoProfile -Command "$PROFILE"';
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch {
    // PS 5.1 default profile path
    return join(homedir(), 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1');
  }
}

// ─── Detect current shell ─────────────────────────────────────────────────────

function detectShell(): string | null {
  // Check $SHELL env var (bash/zsh/fish)
  const shellEnv = process.env.SHELL ?? '';
  if (shellEnv.includes('zsh'))  return 'zsh';
  if (shellEnv.includes('bash')) return 'bash';
  if (shellEnv.includes('fish')) return 'fish';

  // Windows — check PSModulePath or PSVERSION
  if (process.env.PSModulePath || process.env.PSVersionTable) return 'powershell';
  /* v8 ignore next */
  if (process.platform === 'win32') return 'powershell';

  return null;
}

// ─── Command ──────────────────────────────────────────────────────────────────

export async function completionCommand(
  shell: string | undefined,
  options: { install?: boolean }
): Promise<void> {

  // ── Print script for piping/manual sourcing ─────────────────────────────
  if (shell && !options.install) {
    const script = SCRIPTS[shell.toLowerCase()];
    if (!script) {
      log.error(`Unknown shell "${shell}". Supported: bash, zsh, fish, powershell`);
      process.exit(1);
    }
    console.log(script);
    return;
  }

  // ── Interactive install ──────────────────────────────────────────────────
  p.intro(chalk.bold.cyan('  SynapCLI — Shell Completion  '));

  const detectedShell = detectShell();

  const chosenShell = shell ?? (await (async () => {
    const choice = await p.select({
      message: 'Which shell do you use?',
      options: [
        { value: 'bash',       label: 'Bash',       hint: detectedShell === 'bash'       ? 'detected' : '' },
        { value: 'zsh',        label: 'Zsh',        hint: detectedShell === 'zsh'        ? 'detected' : '' },
        { value: 'fish',       label: 'Fish',       hint: detectedShell === 'fish'       ? 'detected' : '' },
        { value: 'powershell', label: 'PowerShell', hint: detectedShell === 'powershell' ? 'detected' : '' },
      ],
      initialValue: detectedShell ?? 'bash',
    });
    if (p.isCancel(choice)) { p.cancel('Cancelled.'); process.exit(0); }
    return choice as string;
  })());

  const script = SCRIPTS[chosenShell];
  if (!script) {
    log.error(`Unknown shell "${chosenShell}".`);
    process.exit(1);
  }

  // Resolve config file path
  if (chosenShell === 'powershell') {
    SHELL_CONFIG.powershell = getPowerShellProfile();
  }
  const configFile = SHELL_CONFIG[chosenShell];

  // Check if already installed
  if (existsSync(configFile)) {
    const existing = readFileSync(configFile, 'utf8');
    if (existing.includes('SynapCLI')) {
      log.warn(`Completion already installed in ${chalk.white(configFile)}`);
      log.dim(`Remove the SynapCLI block manually and re-run to reinstall.`);
      process.exit(0);
    }
  }

  // Preview the script
  log.title('Script that will be appended:');
  console.log();
  console.log(chalk.dim(script));
  console.log();
  log.dim(`Will be appended to: ${chalk.white(configFile)}`);
  console.log();

  const confirmed = await p.confirm({
    message: `Append completion script to ${configFile}?`,
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Install cancelled.');
    console.log();
    log.dim(`You can install manually by running:`);
    console.log(`  ${chalk.white(`synap completion ${chosenShell}`)} ${chalk.dim(`>> ${configFile}`)}`);
    process.exit(0);
  }

  try {
    appendFileSync(configFile, '\n\n' + script + '\n', 'utf8');
    p.outro(chalk.green('Completion installed!'));

    console.log();
    if (chosenShell === 'powershell') {
      log.dim(`Restart PowerShell or run: ${chalk.white(`. $PROFILE`)}`);
    } else if (chosenShell === 'fish') {
      log.dim(`Restart fish or run: ${chalk.white(`source ~/.config/fish/config.fish`)}`);
    } else {
      log.dim(`Restart your terminal or run: ${chalk.white(`source ${configFile}`)}`);
    }

    console.log();
    log.dim(`Tip: Run ${chalk.white('synap list')} first to populate the completion cache.`);
  } catch (err) {
    log.error(`Failed to write to ${configFile}: ${(err as Error).message}`);
    log.dim(`Try manually: synap completion ${chosenShell} >> ${configFile}`);
    process.exit(1);
  }
}