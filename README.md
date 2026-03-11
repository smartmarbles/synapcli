# SynapCLI

A CLI tool for pulling agent and prompt files from a GitHub repository into your JavaScript project.

---

## Requirements

- Node.js 18+
- Git (used to read token from `~/.gitconfig`)

---

## Installation

Clone or download the project, then install dependencies and build:

```bash
cd synapcli
npm install
npm run build
npm link
```

`npm link` makes the `synap` command available globally in your terminal.

---

## Authentication

### Public repositories
No setup needed. Requests are sent unauthenticated automatically.

### Private repositories
SynapCLI looks for your GitHub token in two places, in this order:

**1. OS environment variable**
```bash
# Mac/Linux
export GITHUB_TOKEN=ghp_yourtoken

# Windows PowerShell
$env:GITHUB_TOKEN="ghp_yourtoken"
```

**2. `~/.gitconfig` (recommended — persists across sessions)**

Add the following to your global git config file (`C:\Users\YourName\.gitconfig` on Windows, `~/.gitconfig` on Mac/Linux):

```ini
[synapcli]
    githubToken = ghp_yourtoken
```

Or run this command to set it automatically:
```bash
git config --global synapcli.githubToken ghp_yourtoken
```

Generate a token at [github.com/settings/tokens](https://github.com/settings/tokens). For fine-grained tokens, make sure to grant **Contents: Read-only** permission on the target repository.

---

## Quick Start

```bash
# 1. Set up config in your project
synap init

# 2. Browse available files in the remote repo
synap list

# 3. Pull everything down
synap pull
```

---

## Commands

### `synap init`

Interactively bootstrap a `synap.config.json` in the current directory. Walks you through setting the repo, branch, remote path, and local output directory.

```bash
synap init
```

---

### `synap list`

List all files available in the configured remote repository.

```bash
synap list            # human-readable output with file sizes
synap list --json     # raw JSON output for scripting
```

---

### `synap pull [name]`

Download files from the remote repo into your local output directory. If a file already exists locally but wasn't pulled by SynapCLI, you will be prompted before it is overwritten.

```bash
synap pull                     # pull all files
synap pull summarizer          # pull files matching "summarizer"
synap pull --dry-run           # preview what would be downloaded
synap pull --force             # overwrite all files without prompting
synap pull --branch feat/v2    # pull from a specific branch, tag, or SHA
```

---

### `synap diff [name]`

Show a colored diff of what has changed upstream versus your local files. Uses the lockfile to skip files that haven't changed, minimising API calls.

```bash
synap diff             # diff all tracked files
synap diff summarizer  # diff files matching "summarizer"
```

---

### `synap update [name]`

Pull only files that have changed upstream. Uses SHA comparison via the lockfile so unchanged files are skipped entirely.

```bash
synap update           # update all changed files
synap update --force   # skip confirmation prompt
```

---

### `synap delete [name]`

Delete a tracked file (or all tracked files) from disk and remove the entry from the lockfile.

```bash
synap delete                   # delete all tracked files
synap delete summarizer        # delete files matching "summarizer"
synap delete --dry-run         # preview what would be deleted
synap delete --force           # skip confirmation prompt
```

---

## Configuration

Running `synap init` creates a `synap.config.json` in your project root:

```json
{
  "repo": "owner/repo",
  "branch": "main",
  "remotePath": "agents",
  "localOutput": "src/agents",
  "auth": "env:GITHUB_TOKEN"
}
```

| Field | Description |
|---|---|
| `repo` | GitHub repository as `owner/repo` |
| `branch` | Branch, tag, or commit SHA to pull from (default: `main`) |
| `remotePath` | Folder inside the repo to pull from (leave blank for repo root) |
| `localOutput` | Local directory to write files into |
| `auth` | Set to `"env:GITHUB_TOKEN"` for private repos |

---

## Lockfile

After every pull, SynapCLI writes a `synap.lock.json` that records the exact commit SHA of each file:

```json
{
  "agents/summarizer.md": {
    "sha": "a1b2c3d...",
    "ref": "main",
    "pulledAt": "2024-11-01T12:00:00.000Z"
  }
}
```

Commit this file to version control. It ensures reproducible pulls and powers the `diff`, `update`, and `delete` commands.

---

## Project Structure

```
synapcli-ts/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # CLI entry point
    ├── types.ts              # Shared TypeScript interfaces
    ├── commands/
    │   ├── init.ts           # synap init
    │   ├── pull.ts           # synap pull
    │   ├── list.ts           # synap list
    │   ├── diff.ts           # synap diff
    │   ├── update.ts         # synap update
    │   └── delete.ts         # synap delete
    ├── lib/
    │   ├── github.ts         # GitHub API client
    │   └── config.ts         # Config and lockfile read/write
    └── utils/
        ├── files.ts          # Local file operations
        └── logger.ts         # Colored terminal output
```

---

## Development

```bash
# Run directly from TypeScript source (no build step needed)
npx tsx src/index.ts <command>
OR
npx synap <command>

# Build to dist/
npm run build

# After building, run via the linked global command
synap <command>
```

---

## .gitignore recommendation

```gitignore
node_modules/
dist/
# Do NOT ignore synap.lock.json — commit it
```
