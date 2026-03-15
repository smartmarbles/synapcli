# SynapCLI

A professional CLI tool for pulling agent and prompt files from a GitHub repository into your JavaScript project. Supports multiple sources, glob filtering, lockfile-based diffing, CI/CD pipelines, and more.

---

## Requirements

- Node.js 18+
- Git (used to read token from `~/.gitconfig`)

---

## Installation

```bash
cd synapcli-v2
npm install
npm run build
npm link
```

`npm link` makes the `synap` command available globally in your terminal.

**Or use via npx (once published to npm):**
```bash
npx synapcli <command>
```

---

## Authentication

### Public repositories
No setup needed. Requests are unauthenticated automatically.

### Private repositories
SynapCLI reads your GitHub token from two places, in order:

**1. Session environment variable**
```bash
# Mac/Linux
export GITHUB_TOKEN=ghp_yourtoken

# Windows PowerShell
$env:GITHUB_TOKEN="ghp_yourtoken"
```
Note: this only persists for the current terminal session.

**2. `~/.gitconfig` (recommended — persists permanently)**
```bash
git config --global synapcli.githubToken ghp_yourtoken
```

Generate a token at [github.com/settings/tokens](https://github.com/settings/tokens). For fine-grained tokens, grant **Contents: Read-only** on the target repository.

---

## Quick Start

```bash
# 1. Bootstrap config
synap init

# 2. Validate your setup
synap doctor

# 3. Browse available files
synap list

# 4. See what's changed vs what you have locally
synap status

# 5. Pull everything down
synap pull
```

---

## Commands

### `synap init`
Interactively create a `synap.config.json`. Validates your GitHub token on setup.

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
Download files from the remote repo to your local output directory.

```bash
synap pull                      # pull all files
synap pull summarizer           # pull files matching "summarizer"
synap pull --dry-run            # preview without writing
synap pull --force              # overwrite without prompting
synap pull --branch feat/v2     # pull from a specific branch, tag, or SHA
synap pull --retry-failed       # retry only files that failed in the last run
```

---

### `synap diff [name]`
Show a colored line-by-line diff of what has changed upstream versus your local files.

```bash
synap diff             # diff all tracked files
synap diff summarizer  # diff files matching "summarizer"
```

---

### `synap update [name]`
Pull only files whose upstream SHA has changed. Skips unchanged files entirely.

```bash
synap update           # update all changed files
synap update --force   # skip confirmation prompt
```

---

### `synap delete [name]`
Delete tracked files from disk and remove their entries from the lockfile.

```bash
synap delete                    # delete all tracked files
synap delete summarizer         # delete files matching "summarizer"
synap delete --dry-run          # preview without deleting
synap delete --force            # skip confirmation prompt
```

---

## Configuration

`synap.config.json` supports both a simple single-source format and a multi-source format.

### Single source (simple)

```json
{
  "repo": "acme/ai-agents",
  "branch": "main",
  "remotePath": "agents",
  "localOutput": "src/agents"
}
```

### Multiple sources

```json
{
  "sources": [
    {
      "name": "Agents",
      "repo": "acme/ai-agents",
      "branch": "main",
      "remotePath": "agents",
      "localOutput": "src/agents",
      "include": ["**/*.md"],
      "exclude": ["**/test/**"]
    },
    {
      "name": "Prompts",
      "repo": "acme/prompt-library",
      "branch": "main",
      "remotePath": "prompts",
      "localOutput": "src/prompts"
    }
  ],
  "postpull": "prettier --write src/agents src/prompts"
}
```

### Config reference

| Field | Description |
|---|---|
| `repo` | GitHub repository as `owner/repo` |
| `branch` | Branch, tag, or commit SHA (default: `main`) |
| `remotePath` | Folder inside the repo to pull from (blank = repo root) |
| `localOutput` | Local directory to write files into |
| `include` | Glob patterns — only matching files are pulled |
| `exclude` | Glob patterns — matching files are skipped |
| `postpull` | Shell command run automatically after any pull or update |
| `sources` | Array of the above for multi-source projects |

---

## Lockfile

After every pull, SynapCLI writes `synap.lock.json` recording the exact commit SHA of each file. Keys are namespaced by repo to support multiple sources.

```json
{
  "acme/ai-agents::agents/summarizer.md": {
    "sha": "a1b2c3d...",
    "ref": "main",
    "pulledAt": "2024-11-01T12:00:00.000Z"
  }
}
```

**Commit this file.** It ensures reproducible pulls and powers `status`, `diff`, `update`, and `delete`.

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

A ready-to-use workflow is included at `.github/workflows/sync-agents.yml`. Add your token as a repository secret named `SYNAP_GITHUB_TOKEN` and it will automatically sync on a daily schedule.

---

## Development

```bash
# Run directly from TypeScript source
npx tsx src/index.ts <command>

# Build to dist/
npm run build

# Run tests
npm test

# Watch mode for tests
npm run test:watch
```

---

## Project Structure

```
synapcli-v2/
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
    │   └── doctor.ts             # synap doctor
    ├── lib/
    │   ├── github.ts             # GitHub API client (retry, rate limits)
    │   ├── config.ts             # Config and lockfile read/write
    │   ├── filter.ts             # Glob pattern filtering
    │   ├── hooks.ts              # Post-pull hook runner
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
        └── retry.test.ts
```

---

## .gitignore recommendation

```gitignore
node_modules/
dist/
# Do NOT ignore synap.lock.json — commit it
```
