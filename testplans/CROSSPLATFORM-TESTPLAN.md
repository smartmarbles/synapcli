# SynapCLI — Cross-Platform Smoke Test

A **minimal** manual test plan for verifying core functionality across OS + shell combinations. Since most commands share the same underlying layers (config I/O, GitHub API, file writing, lockfile, exit codes), we only test **one representative command per layer** rather than every command.

---

## Test Matrix

Run the full plan once per cell you want to cover:

| OS | Shell | Priority |
|---|---|---|
| **Windows 11** | PowerShell 5.1 | Required |
| **Windows 11** | PowerShell 7+ (pwsh) | Required |
| **macOS** | zsh | Required |
| **Linux (Ubuntu)** | bash | Required |
| **macOS** | bash | Recommended |
| **Linux** | fish | Optional |
| **Windows (WSL)** | bash | Optional |

---

## Prerequisites

- Node.js 20.12+
- Git installed and on PATH
- A public GitHub repo with a few files (e.g. `smartmarbles/synapcli-test-assets`)
- SynapCLI built and linked: `npm run build && npm link`

---

## What Each Test Covers

| # | Test | Layers exercised |
|---|---|---|
| 1 | Install + version | npm global install, PATH resolution, ESM entry point |
| 2 | Doctor (no config) | `git --version` child_process, Node version check, file existence, exit codes |
| 3 | Init | Interactive prompts (TTY), config file writing, `os.homedir()` |
| 4 | List | GitHub API (fetch/undici), terminal formatting/colours, completion cache write (`~/.synap/`) |
| 5 | Pull | File download + write, lockfile creation, path separators |
| 6 | Pull with postpull hook | `execSync` hook in native shell, OS-specific command syntax |
| 7 | Status | Lockfile read, local file existence check |
| 8 | Error exit code | `process.exitCode` propagation (Windows libuv regression guard) |
| 9 | Completion install | Shell detection, profile path resolution, script append |
| 10 | Uninstall cleanup | Profile block removal, `~/.synap/` cache deletion |

---

## The Tests

### 1 — Install + version
```bash
npm install -g synapcli
synap --version
```
**Expected:** Prints version (e.g. `1.0.0`) and exits 0.

**What this proves:** npm global install works, the `synap` bin is on PATH, ESM entry point loads.

---

### 2 — Doctor (no config)
```bash
cd "$(mktemp -d)"          # Unix
# or: cd $env:TEMP; mkdir synap-test; cd synap-test   # PowerShell

synap doctor
```
**Expected:**
- ✔ Node.js version passes
- ✔ Git available
- ✖ `synap.config.json` missing — suggests `synap init`
- Exit code 1

**Verify exit code:**
```bash
echo $?                     # bash/zsh/fish
echo $LASTEXITCODE          # PowerShell
```

**What this proves:** child_process (`git --version`), file reads, exit code propagation.

---

### 3 — Init
```bash
synap init
```
Walk through the wizard:
1. Enter a public repo (e.g. `owner/repo`)
2. Accept defaults for branch/path
3. Select `Project root` as output directory
4. Answer **No** to another repository
5. Answer **No** to shell completion

**Expected:**
- Interactive prompts render correctly (no garbled characters)
- `synap.config.json` created in the current directory

**Verify:**
```bash
cat synap.config.json       # bash/zsh/fish
Get-Content synap.config.json  # PowerShell
```

**What this proves:** TTY/interactive prompts work, file writing with correct path separators.

---

### 4 — List
```bash
synap list
```
**Expected:**
- Spinner animates while fetching
- Files listed with sizes
- Completion cache created at `~/.synap/completions.json`

**Verify cache:**
```bash
cat ~/.synap/completions.json                      # bash/zsh/fish
Get-Content "$env:USERPROFILE\.synap\completions.json"  # PowerShell
```

**What this proves:** GitHub API works (fetch/undici), terminal colours/formatting, `os.homedir()` path, cache file I/O.

---

### 5 — Pull
```bash
synap pull
```
Confirm when prompted.

**Expected:**
- Progress bar renders
- Files written to output directory
- `synap.lock.json` created

**Verify:**
```bash
cat synap.lock.json
ls <output-dir>/            # or Get-ChildItem on PowerShell
```

**What this proves:** File download, disk write, lockfile creation, path.join() handling.

---

### 6 — Postpull hook

Edit `synap.config.json` to add a hook:

**Unix (bash/zsh/fish):**
```json
{
  "repo": "owner/repo",
  "branch": "main",
  "remotePath": "",
  "localOutput": ".",
  "postpull": "echo hook-ok"
}
```

**Windows (PowerShell):**
```json
{
  "repo": "owner/repo",
  "branch": "main",
  "remotePath": "",
  "localOutput": ".",
  "postpull": "echo hook-ok"
}
```

> `echo` works on all platforms. For a stronger test on Windows, use `Write-Output hook-ok` or `cmd /c echo hook-ok`.

```bash
synap pull --force
```

**Expected:** `hook-ok` printed after files are written.

**What this proves:** `execSync` runs in the correct native shell, hook commands execute.

---

### 7 — Status
```bash
synap status
```

**Expected:** All files shown as "Up to date".

**What this proves:** Lockfile reading, local file stat/existence checks, path resolution.

---

### 8 — Error exit code
```bash
synap list nonexistent-path-xyz
```

**Expected:**
- Error message: `✖ GitHub API error 404: Not Found`
- Exit code 4
- **No crash** (no `UV_HANDLE_CLOSING` assertion on Windows)

**Verify exit code:**
```bash
echo $?                     # bash/zsh/fish
echo $LASTEXITCODE          # PowerShell
```

**What this proves:** Graceful error exit via `process.exitCode`, no libuv crash on Windows (the specific regression this guards against).

---

### 9 — Completion install
```bash
synap completion --install
```
Select the shell matching your test environment and confirm.

**Expected:**
- Completion block appended to the correct profile:
  - bash → `~/.bashrc`
  - zsh → `~/.zshrc`
  - fish → `~/.config/fish/config.fish`
  - powershell → `$PROFILE`
- Instructions to reload the shell shown

**Verify:**
```bash
# Reload shell, then:
synap <TAB>
synap pull <TAB>
```
Tab completion should suggest commands/filenames.

**What this proves:** Shell detection, profile path resolution (especially PowerShell `$PROFILE`), script file append, tab completion runtime.

---

### 10 — Uninstall cleanup
```bash
npm uninstall -g synapcli
```

**Expected:**
- "Removed SynapCLI completion from [profile]" printed
- "Removed SynapCLI cache directory ~/.synap" printed

**Verify:**
```bash
# Profile no longer contains the SynapCLI block
cat ~/.bashrc               # or ~/.zshrc, $PROFILE, etc.

# Cache dir removed
ls ~/.synap                 # should not exist
# or: Test-Path "$env:USERPROFILE\.synap"  → False

# Command gone
synap --version             # should fail — command not found
```

**What this proves:** preuninstall script runs, profile cleanup, cache directory removal.

---

## Quick-Reference Results Template

Copy this table and fill it in per environment:

| # | Test | OS | Shell | Pass/Fail | Notes |
|---|---|---|---|---|---|
| 1 | Install + version | | | | |
| 2 | Doctor (no config) | | | | |
| 3 | Init | | | | |
| 4 | List | | | | |
| 5 | Pull | | | | |
| 6 | Postpull hook | | | | |
| 7 | Status | | | | |
| 8 | Error exit code | | | | |
| 9 | Completion install | | | | |
| 10 | Uninstall cleanup | | | | |

---

## What's intentionally omitted

The following commands are **not** tested here because they exercise the same layers already covered above:

| Command | Covered by |
|---|---|
| `diff` | Same lockfile read + GitHub fetch as **status** + **list** |
| `update` | Same fetch + write + preview as **pull** |
| `delete` | Same lockfile write + `fs.unlinkSync` as **pull** |
| `register` | Same interactive prompts + config write as **init** |
| `deregister` | Same interactive prompts + config write as **init** |
| `--ci` mode | CI output is a formatting layer on top of the same I/O — verified by unit tests |
| `--interactive` | Same `@clack/prompts` multiselect as **init** prompts |
| `--dry-run` | Pure logic — no platform I/O surface |

See [TESTPLAN.md](TESTPLAN.md) for exhaustive coverage of every command and flag.

---

## Automated CI Coverage

Tests 1–8 (everything except completion install and uninstall cleanup) run automatically via [`.github/workflows/cross-platform.yml`](.github/workflows/cross-platform.yml) on every release and on manual dispatch. The workflow covers:

| OS | Shell |
|---|---|
| Ubuntu (latest) | bash |
| macOS (latest) | bash |
| Windows (latest) | PowerShell 7+ (pwsh) |
| Windows (latest) | Windows PowerShell 5.1 |

Tests 9 (completion install) and 10 (uninstall cleanup) require interactive shell sessions and real profile files, so they remain manual-only.
