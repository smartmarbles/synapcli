# SynapCLI

A professional CLI tool for syncing files from a GitHub repository into any project, regardless of language or framework. Designed with AI-assisted development in mind — sharing agent definitions, system prompts, copilot instructions, and coding standards across a portfolio of projects — but works equally well for any files you want to distribute from a central source of truth. Requires only Node.js 18+ on the target machine. Supports multiple sources, glob filtering, lockfile-based diffing, tab completion, CI/CD pipelines, and more.

---

## Requirements

- Node.js 18+ (the only requirement — works in any project regardless of language or framework)
- Git (used to read token from `~/.gitconfig`)

---

## Installation

**Install globally** so the `synap` command is available in any project:
```bash
npm install -g synapcli
```

**Or use via npx** without installing:
```bash
npx synap <command>
```

---

## Authentication

### Public repositories
No setup needed. Requests are unauthenticated automatically.

### Private repositories
SynapCLI reads your GitHub token from two places, in order:

**1. OS environment variable**
```bash
# Mac/Linux
export GITHUB_TOKEN=ghp_yourtoken

# Windows PowerShell
$env:GITHUB_TOKEN="ghp_yourtoken"
```

**2. `~/.gitconfig` (recommended — persists across sessions)**
```bash
git config --global synapcli.githubToken ghp_yourtoken
```

Or add it manually to `~/.gitconfig`:
```ini
[synapcli]
    githubToken = ghp_yourtoken
```

Generate a token at [github.com/settings/tokens](https://github.com/settings/tokens). For fine-grained tokens, grant **Contents: Read-only** on the target repository.

---

## Quick Start

```bash
# 1. Bootstrap config in your project (supports multiple repos from the start)
synap init

# 2. Validate your entire setup
synap doctor

# 3. Add another repository later
synap register

# 4. Remove a repository
synap deregister

# 5. Browse available files in the remote repo
synap list

# 6. See the sync status of all tracked files
synap status

# 7. Pull everything down
synap pull

# 8. Pull a specific file at a specific ref (branch, tag, or commit SHA)
synap pull --ref v1.2.0 copilot-instructions<TAB>

# 9. Pull interactively — choose files from a checklist
synap pull --interactive

# 10. See what changed upstream vs your local files
synap diff

# 11. Pull only files that have changed
synap update

# 12. Delete a tracked file
synap delete summarizer

# 13. Install shell tab completion (only needed if skipped during init)
synap completion --install
```

---

## Commands

### `synap init`
Interactively create a `synap.config.json`. Supports registering multiple repositories in a single session. Validates your GitHub token on setup and offers to install shell tab completion.

---

### `synap doctor`
Health check for your entire setup — Node version, git, token validity, repo access, and output directory permissions.

```bash
synap doctor
```

---

### `synap list`
List all files available in the configured remote repository.

```bash
synap list            # human-readable output
synap list --json     # machine-readable JSON for scripting
```

---

### `synap status`
Show the sync status of every tracked file at a glance — similar to `git status`.

```bash
synap status
```

Output groups files into four states:
- **Changed upstream** — the remote file has a newer SHA than your local copy
- **Missing locally** — was pulled before but the local file has been deleted
- **Not yet pulled** — exists in the remote repo but hasn't been pulled yet
- **Up to date** — local file matches the remote SHA exactly

---

### `synap pull [name]`
Download files from the remote repo to your local output directory. Shows a status preview and asks for confirmation before writing. Supports tab completion on the name argument.

```bash
synap pull                      # pull all files (with preview + confirm)
synap pull summarizer           # pull files matching "summarizer"
synap pull --interactive        # choose files from a checklist
synap pull --dry-run            # preview without writing
synap pull --force              # overwrite without prompting
synap pull --ref feat/v2        # pull from a specific branch
synap pull --ref v1.2.0         # pull from a tag
synap pull --ref a1b2c3d        # pull from a specific commit SHA
synap pull --retry-failed       # retry only files that failed in the last run
```

---

### `synap diff [name]`
Show a colored line-by-line diff of what has changed upstream versus your local files. Supports tab completion on the name argument.

```bash
synap diff             # diff all tracked files
synap diff summarizer  # diff files matching "summarizer"
```

---

### `synap update [name]`
Pull only files whose upstream SHA has changed. Skips unchanged files entirely. Supports tab completion on the name argument.

```bash
synap update                    # update all changed files (with preview + confirm)
synap update summarizer         # update files matching "summarizer"
synap update --interactive      # choose which changed files to update
synap update --force            # skip confirmation prompt
```

---

### `synap delete [name]`
Delete tracked files from disk and remove their entries from the lockfile. Supports tab completion on the name argument.

```bash
synap delete                    # delete all tracked files
synap delete summarizer         # delete files matching "summarizer"
synap delete --dry-run          # preview without deleting
synap delete --force            # skip confirmation prompt
```

---

### `synap completion [shell]`
Output or install shell tab completion. Supports bash, zsh, fish, and PowerShell (including 5.1). Reads directly from the local cache file — no Node subprocess on every tab press.

```bash
synap completion --install      # interactive install (auto-detects your shell)
synap completion powershell     # print the PowerShell script to stdout
synap completion bash           # print the bash script to stdout
```

---

### `synap register`
Add one or more repositories to an existing `synap.config.json`. Automatically migrates a single-source config to the multi-source format if needed. Detects and skips duplicate repos.

```bash
synap register
```

---

### `synap deregister`
Remove a registered repository from `synap.config.json`. Presents a checklist of current sources to choose from. Cleans up orphaned lock entries automatically. Local files already pulled are not deleted — run `synap delete` separately if you want to remove them.

```bash
synap deregister
```

---

## Configuration

`synap.config.json` supports both a simple single-source format and a multi-source format.

### Single source (simple)

```json
{
  "repo": "acme-org/ai-agents",
  "branch": "main",
  "remotePath": "",
  "localOutput": "."
}
```

### Multiple sources

```json
{
  "sources": [
    {
      "name": "Agents",
      "repo": "acme-org/ai-agents",
      "branch": "main",
      "remotePath": "agents",
      "localOutput": ".",
      "include": ["**/*.md"],
      "exclude": ["**/test/**"]
    },
    {
      "name": "Prompts",
      "repo": "widgets-inc/prompt-library",
      "branch": "main",
      "remotePath": "prompts",
      "localOutput": "src/prompts"
    }
  ],
  "postpull": "prettier --write ."
}
```

### Config reference

| Field | Description |
|---|---|
| `repo` | GitHub repository as `owner/repo` |
| `branch` | Branch, tag, or commit SHA (default: `main`) |
| `remotePath` | Folder inside the repo to pull from (blank = repo root) |
| `localOutput` | Local directory to write files into (default: `.`) |
| `include` | Glob patterns — only matching files are pulled |
| `exclude` | Glob patterns — matching files are skipped |
| `postpull` | Shell command run automatically after any pull or update |
| `sources` | Array of the above for multi-source projects |

---

## Lockfile

After every pull, SynapCLI writes `synap.lock.json` recording the exact commit SHA of each file. Keys are namespaced by repo to support multiple sources.

```json
{
  "acme-org/ai-agents::agents/summarizer.md": {
    "sha": "a1b2c3d...",
    "ref": "main",
    "pulledAt": "2024-11-01T12:00:00.000Z"
  }
}
```

**Commit this file.** It ensures reproducible pulls and powers `status`, `diff`, `update`, and `delete`.

---

## Tab Completion

SynapCLI supports tab completion for file names on `pull`, `update`, `diff`, and `delete`. Completions are read from a local cache file (`~/.synap/completions.json`) — no network call on every tab press.

The cache is populated automatically whenever you run `synap list`, `synap pull`, or `synap update`.

```bash
synap pull co<TAB>       # completes to matching file names
synap delete summ<TAB>   # same
```

**Supported shells:**

| Shell | Platform | Notes |
|---|---|---|
| zsh | Mac, Linux | Default shell on macOS Catalina (2019) and later |
| bash | Mac, Linux, Windows | Default on older Macs and most Linux distros |
| fish | Mac, Linux | |
| PowerShell 5.1+ | Windows, Mac, Linux | Recommended shell for Windows users |
| Git Bash | Windows | Ships with Git for Windows — runs real bash, so the bash completion script applies |

**Not supported: Windows Command Prompt (cmd.exe)** — Command Prompt has no custom completion API. It only supports basic file path completion built into the OS and cannot be extended by third-party tools. If you are on Windows, use PowerShell or Git Bash instead — both are available in VS Code's integrated terminal.

> **Git Bash note:** When installing via `synap completion --install`, select `bash`. The script will be appended to `~/.bashrc`. If completions don't appear after restarting Git Bash, add `source ~/.bashrc` to your `~/.bash_profile` — Git Bash sometimes loads `.bash_profile` instead of `.bashrc` on startup.

**Install:**
```bash
synap completion --install   # auto-detects your shell and appends the script
```

Or print the script manually for a specific shell:
```bash
synap completion powershell >> $PROFILE
synap completion bash >> ~/.bashrc
```

---

## CI/CD

Pass `--ci` to any command to enable CI mode:
- No interactive prompts
- Plain text output (no ANSI color codes)
- Strict failures — conflicts exit with a non-zero code instead of prompting

```bash
synap pull --ci --force
synap update --ci --force
```

> **Note on `env`:** SynapCLI's own config file (`synap.config.json`) has no `env` block — the token is read from your OS environment or `~/.gitconfig`. The `env:` keyword you'll see in the GitHub Actions workflow below is standard GitHub Actions syntax for passing a secret into a workflow step as an environment variable. They are unrelated — one is SynapCLI config, the other is GitHub Actions plumbing.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | General error |
| `2` | Config error (missing or invalid `synap.config.json`) |
| `3` | Auth error (invalid or missing token) |
| `4` | Network error (GitHub API unreachable or 404) |
| `5` | Conflict error (file conflict in CI mode without `--force`) |

### GitHub Actions example

A ready-to-use workflow is included at `.github/workflows/sync-agents.yml`. It runs on a daily schedule and commits any changed files back to your repository automatically.

#### Understanding secrets in GitHub Actions

`${{ secrets.X }}` is how a workflow accesses an encrypted value you have stored in GitHub. You set these once under **Repository → Settings → Secrets and variables → Actions → New repository secret**, and GitHub injects them securely at runtime — they are never visible in logs or to other users.

`secrets.GITHUB_TOKEN` is a special case — GitHub creates it automatically for every repository. You never have to set it up yourself. It is scoped to the repository the workflow is running in and expires when the workflow finishes.

#### Which token to use

The following examples all show the relevant step inside `.github/workflows/sync-agents.yml`.

**Public agent repo** — remove the `env` block entirely. No token needed:
```yaml
- name: Pull latest agents and prompts
  run: synap pull --ci --force
```

**Private agent repo in the same GitHub organization** — use the built-in token. No setup required:
```yaml
- name: Pull latest agents and prompts
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: synap pull --ci --force
```

**Private agent repo in a different organization or personal account** — the built-in token won't have access. Create a Personal Access Token (PAT) with **Contents: Read-only** on the agent repo, add it as a repository secret, then reference it by the secret name you chose:
```yaml
- name: Pull latest agents and prompts
  env:
    GITHUB_TOKEN: ${{ secrets.AGENT_REPO_TOKEN }}
  run: synap pull --ci --force
```

#### Pulling from multiple private repos

SynapCLI reads a single `GITHUB_TOKEN` environment variable, so you cannot pass a different token per repo. The solution is to create **one PAT** and grant it **Contents: Read-only** access to each private repo individually when setting it up.

For example, if your `synap.config.json` pulls from both `acme-org/ai-agents` and `widgets-inc/prompt-library`:

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) and create a new fine-grained PAT
2. Under **Repository access**, add each repo individually — they can be from different organizations, for example `acme-org/ai-agents` and `widgets-inc/prompt-library`. You must be a member of each org to grant access to its repos.
3. Under **Permissions**, set **Contents** to `Read-only`
4. Copy the generated token
5. In your project on GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**, name it `SYNAP_TOKEN`, and paste the token
6. Reference it in your workflow:

```yaml
- name: Pull latest agents and prompts
  env:
    GITHUB_TOKEN: ${{ secrets.SYNAP_TOKEN }}
  run: synap pull --ci --force
```

This one token covers all repos listed in your `synap.config.json`, so no additional secrets are needed.

---

## How SynapCLI Compares

### vs Git Submodules

Git submodules are the closest built-in alternative — they embed one repo inside another and pin to a specific commit. On paper they sound similar but in practice they are notoriously painful. Cloning a repo with submodules requires `git clone --recurse-submodules` or a separate `git submodule update --init`, and new team members forget this constantly. Updating a submodule requires navigating into the submodule directory, pulling, then committing the parent repo to record the new SHA. They also bring the entire repository history rather than just the files you need, and CI pipelines require extra configuration to handle them.

SynapCLI is **file-focused rather than repo-focused**. You pull exactly the files you want, they land as normal files in your project with no git entanglement, and updating is a single command. The lockfile gives you the same reproducibility guarantee as a pinned submodule SHA, without the complexity.

### vs Copier / Cookiecutter

These Python-based scaffolding tools pull templates from a GitHub repo and stamp them into a new project. Copier in particular has an `update` command that can re-apply upstream template changes, which is conceptually similar to `synap update`. The differences are that they are Python-based, template-centric with variable substitution as a first-class feature, and designed for one-time project creation rather than ongoing file sync across many existing projects.

### vs npm packages

The most common enterprise approach is to publish shared files as a versioned npm package and install them. This is robust and integrates with existing tooling, but it adds a publish step every time something changes, requires an npm account or private registry, and files end up buried in `node_modules` rather than sitting in your project where you can read and edit them directly.

### vs Turborepo / Nx

Monorepo tools solve a related problem — sharing code across packages — but they require everyone to be in the same monorepo. This doesn't work when you want to share agents and prompts across completely separate client projects maintained by different teams.

### vs GitHub Actions file sync

Some teams use GitHub Actions to automatically push files from a central repo into target repos on every commit. This works well for CI but has no local developer workflow — you cannot run it from your terminal, preview changes, or selectively pull individual files.

### Where SynapCLI fits best

SynapCLI is most valuable in these situations:

**AI-assisted development teams** — sharing a central library of agent definitions, system prompts, and copilot instructions across multiple projects. As these files evolve, `synap update` keeps every project in sync without manual copying.

**Design system and standards distribution** — distributing coding standards, architecture guidelines, and documentation templates from a central source of truth into many downstream projects. The lockfile ensures every project can be audited for which version of each standard it is running.

**Cross-project configuration sync** — sharing ESLint configs, TypeScript configs, CI workflow templates, or any other boilerplate files that need to stay consistent across a portfolio of projects, with the ability to opt into updates on your own schedule rather than being forced by a package version bump.

**Teams without monorepo infrastructure** — getting the benefits of shared, versioned files without the overhead of setting up and maintaining Turborepo, Nx, or a private npm registry.

---

---

# For Contributors

---

## Building from Source

If you are contributing to SynapCLI or want to run it directly from source:

```bash
# Clone the repo and install dependencies
cd synapcli
npm install

# Build TypeScript to dist/
npm run build

# Link globally so the synap command points to your local build
npm link

# Run directly from TypeScript source without building
npx tsx src/index.ts <command>

# Run tests
npm test

# Watch mode for tests
npm run test:watch
```

---

## Project Structure

```
synapcli/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .github/
│   └── workflows/
│       └── sync-agents.yml       # Ready-to-use CI workflow
└── src/
    ├── index.ts                  # CLI entry point
    ├── types.ts                  # All shared TypeScript interfaces
    ├── commands/
    │   ├── init.ts               # synap init
    │   ├── pull.ts               # synap pull
    │   ├── list.ts               # synap list
    │   ├── status.ts             # synap status
    │   ├── diff.ts               # synap diff
    │   ├── update.ts             # synap update
    │   ├── delete.ts             # synap delete
    │   ├── doctor.ts             # synap doctor
    │   └── completion.ts         # synap completion
    ├── lib/
    │   ├── github.ts             # GitHub API client (retry, rate limits)
    │   ├── config.ts             # Config and lockfile read/write
    │   ├── filter.ts             # Glob pattern filtering
    │   ├── hooks.ts              # Post-pull hook runner
    │   ├── preview.ts            # Status preview and interactive selection
    │   ├── completionCache.ts    # Tab completion cache
    │   └── retry.ts              # Exponential backoff retry
    ├── utils/
    │   ├── files.ts              # Local file operations
    │   ├── logger.ts             # CI-aware colored output
    │   ├── progress.ts           # Progress bar (degrades in CI)
    │   └── context.ts            # Global CI mode flag
    └── tests/
        ├── config.test.ts
        ├── files.test.ts
        ├── filter.test.ts
        ├── retry.test.ts
        └── completionCache.test.ts
```

---

## .gitignore recommendation

```gitignore
node_modules/
dist/
# Do NOT ignore synap.lock.json — commit it
```
