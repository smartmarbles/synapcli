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
bind 'set show-all-if-ambiguous on' 2>/dev/null

_synap_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local cmd="\${COMP_WORDS[1]}"

  case "$cmd" in
    pull|update|diff|delete)
      # Cache the cwd hash — recompute only when the directory changes
      if [[ "$_synap_cached_cwd" != "$PWD" ]]; then
        _synap_cached_cwd="$PWD"
        _synap_cached_hash=$(printf '%s' "$PWD" | md5sum 2>/dev/null | cut -d' ' -f1)
        [ -z "$_synap_cached_hash" ] && _synap_cached_hash=$(printf '%s' "$PWD" | md5 -q 2>/dev/null)
      fi
      local cache_file="$HOME/.synap/completions/\${_synap_cached_hash}.txt"
      if [ -f "$cache_file" ]; then
        local IFS=$'\\n'
        COMPREPLY=($(grep -Fi -- "$cur" "$cache_file" 2>/dev/null))
        if [ \${#COMPREPLY[@]} -gt 20 ]; then
          COMPREPLY+=("# \${#COMPREPLY[@]} results — narrow your search")
        fi
      fi
      ;;
    collection)
      COMPREPLY=($(compgen -W "create" -- "$cur"))
      ;;
    *)
      COMPREPLY=($(compgen -W "init pull list status diff update delete doctor completion register deregister install collection" -- "$cur"))
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
      local hash
      hash=$(printf '%s' "$PWD" | md5sum 2>/dev/null | cut -d' ' -f1)
      [ -z "$hash" ] && hash=$(printf '%s' "$PWD" | md5 -q 2>/dev/null)
      local cache_file="$HOME/.synap/completions/\${hash}.txt"
      if [ -f "$cache_file" ]; then
        local -a files
        files=("\${(@f)$(grep -Fi -- "\${words[-1]}" "$cache_file" 2>/dev/null)}")
        compadd -a files
      fi
      ;;
    collection)
      local -a subcmds
      subcmds=('create:Create a collection file from tracked files')
      _describe 'subcommand' subcmds
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
        'register:Add repositories to config'
        'deregister:Remove a repository from config'
        'install:Install files from an asset collection'
        'collection:Author and manage asset collections'
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
        set -l hash
        if command -q md5sum
            set hash (printf '%s' $PWD | md5sum | cut -d' ' -f1)
        else if command -q md5
            set hash (printf '%s' $PWD | md5 -q)
        end
        if test -n "$hash"
            set -l cache_file "$HOME/.synap/completions/$hash.txt"
            if test -f $cache_file
                grep -Fi -- (commandline -ct) $cache_file 2>/dev/null
            end
        end
    end
end

# Subcommands
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion register deregister install collection' \\
  -a 'init'        -d 'Bootstrap SynapCLI config'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion register deregister install collection' \\
  -a 'pull'        -d 'Fetch files from remote repo'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion register deregister install collection' \\
  -a 'list'        -d 'List available files'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion register deregister install collection' \\
  -a 'status'      -d 'Show sync status'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion register deregister install collection' \\
  -a 'diff'        -d 'Show upstream changes'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion register deregister install collection' \\
  -a 'update'      -d 'Pull only changed files'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion register deregister install collection' \\
  -a 'delete'      -d 'Delete tracked files'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion register deregister install collection' \\
  -a 'doctor'      -d 'Validate your setup'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion register deregister install collection' \\
  -a 'completion'  -d 'Install shell completion'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion register deregister install collection' \\
  -a 'register'    -d 'Add repositories to config'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion register deregister install collection' \\
  -a 'deregister'  -d 'Remove a repository from config'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion register deregister install collection' \\
  -a 'install'     -d 'Install files from an asset collection'
complete -c synap -f -n 'not __fish_seen_subcommand_from init pull list status diff update delete doctor completion register deregister install collection' \\
  -a 'collection'  -d 'Author and manage asset collections'

# collection subcommands
complete -c synap -f -n '__fish_seen_subcommand_from collection' -a 'create' -d 'Create a collection file'

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
    $lower = $wordToComplete.ToLower()
    return $entry.Value.files | Where-Object {
      $filename = ($_ -split '/')[-1]
      $_.ToLower().Contains($lower) -or $filename.ToLower().StartsWith($lower)
    }
  } catch {
    return @()
  }
}

$global:_synapOriginalTabExpansion2 = $function:TabExpansion2
function global:TabExpansion2 {
  param($inputScript, $cursorColumn, $options)
  $tokens = $inputScript.TrimStart() -split '\\s+'
  if ($tokens[0] -eq 'synap' -and $tokens.Count -ge 2) {
    $wordToComplete = if ($inputScript.EndsWith(' ')) { '' } else { $tokens[-1] }
    $cmd = $tokens[1]
    if ($cmd -in @('pull', 'update', 'diff', 'delete')) {
      $results = _SynapGetCompletions $wordToComplete
      if ($results) {
        $col = [System.Collections.ObjectModel.Collection[System.Management.Automation.CompletionResult]]::new()
        $results | ForEach-Object { $col.Add([System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)) }
        $replStart = $cursorColumn - $wordToComplete.Length
        return [System.Management.Automation.CommandCompletion]::new($col, -1, $replStart, $wordToComplete.Length)
      }
    } elseif ($cmd -eq 'collection') {
      $col = [System.Collections.ObjectModel.Collection[System.Management.Automation.CompletionResult]]::new()
      @('create') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        $col.Add([System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_))
      }
      if ($col.Count -gt 0) {
        $replStart = $cursorColumn - $wordToComplete.Length
        return [System.Management.Automation.CommandCompletion]::new($col, -1, $replStart, $wordToComplete.Length)
      }
    } else {
      $col = [System.Collections.ObjectModel.Collection[System.Management.Automation.CompletionResult]]::new()
      @('init','pull','list','status','diff','update','delete','doctor','completion','register','deregister','install','collection') |
        Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
          $col.Add([System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_))
        }
      if ($col.Count -gt 0) {
        $replStart = $cursorColumn - $wordToComplete.Length
        return [System.Management.Automation.CommandCompletion]::new($col, -1, $replStart, $wordToComplete.Length)
      }
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
    /* v8 ignore start */
    const cmd = process.platform === 'win32'
      ? 'powershell -NoProfile -Command "$PROFILE"'
      : 'pwsh -NoProfile -Command "$PROFILE"';
    /* v8 ignore stop */
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
  /* v8 ignore start */
  if (process.platform === 'win32') return 'powershell';
  return null;
  /* v8 ignore stop */
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
      /* v8 ignore start */
      initialValue: detectedShell ?? 'bash',
      /* v8 ignore stop */
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
    /* v8 ignore start */
    if (existing.includes('SynapCLI')) {
    /* v8 ignore stop */
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

    // On systems where every terminal is a login shell (Git Bash / MINGW),
    // ~/.bashrc is only sourced if ~/.bash_profile explicitly loads it.
    // Create a minimal ~/.bash_profile bridge when none of the login-shell
    // profile files exist, so completions work on the very next terminal.
    if (chosenShell === 'bash') {
      const bashProfile = join(homedir(), '.bash_profile');
      const bashLogin   = join(homedir(), '.bash_login');
      const profile     = join(homedir(), '.profile');
      if (!existsSync(bashProfile) && !existsSync(bashLogin) && !existsSync(profile)) {
        writeFileSync(bashProfile, '# Created by SynapCLI — load .bashrc for login shells\nif [ -f ~/.bashrc ]; then . ~/.bashrc; fi\n', 'utf8');
        log.dim(`Created ${chalk.white('~/.bash_profile')} to source ~/.bashrc in login shells.`);
      }
    }

    p.outro(chalk.green('Completion installed!'));

    console.log();
    if (chosenShell === 'powershell') {
      log.dim(`Restart PowerShell or run: ${chalk.white(`. $PROFILE`)}`);
    } else if (chosenShell === 'fish') {
      log.dim(`Restart fish or run: ${chalk.white(`source ~/.config/fish/config.fish`)}`);
    } else {
      log.dim(`Completion will load automatically in new terminals.`);
      log.dim(`To activate in this session: ${chalk.white(`source ${configFile}`)}`);
    }

    console.log();
    log.dim(`Tip: Tab completion for file names works after running any command that fetches files (init, register, list, pull, update).`);
  } catch (err) {
    log.error(`Failed to write to ${configFile}: ${(err as Error).message}`);
    log.dim(`Try manually: synap completion ${chosenShell} >> ${configFile}`);
    process.exit(1);
  }
}