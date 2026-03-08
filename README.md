# SynapCLI

Pull agent and prompt files from a GitHub repository into your JavaScript project.

```bash
npx synapcli init
```

---

## Installation

**Use via npx (no install needed):**
```bash
npx synapcli <command>
```

**Or install globally:**
```bash
npm install -g synapcli
synap <command>
```

---

## Quick Start

```bash
# 1. Initialize config in your project
synap init

# 2. Browse available files in the remote repo
synap list

# 3. Pull everything down
synap pull

# 4. Pull a specific file
synap pull summarizer
```

---

## Commands

### `synap init`
Interactively bootstrap a `synap.config.json` in the current directory.

### `synap list`
List all agent/prompt files available in the configured remote repo.

```bash
synap list           # human-readable output
synap list --json    # machine-readable JSON
```

### `synap pull [name]`
Download files from the remote repo to your local output directory.

```bash
synap pull                    # pull all files
synap pull summarizer         # pull files matching "summarizer"
synap pull --dry-run          # preview without writing
synap pull --force            # overwrite without prompting
synap pull --branch feat/v2   # pull from a specific branch/tag/SHA
```

### `synap diff [name]`
Show a colored diff of what has changed upstream versus your local files.

```bash
synap diff             # diff all tracked files
synap diff summarizer  # diff files matching "summarizer"
```

### `synap update [name]`
Pull only files that have changed upstream (uses SHA comparison via lockfile).

```bash
synap update           # update all changed files
synap update --force   # skip confirmation prompt
```

---

## Configuration

Running `synap init` creates a `synap.config.json`:

```json
{
  "repo": "acme/ai-agents",
  "branch": "main",
  "remotePath": "agents",
  "localOutput": "src/agents",
  "auth": "env:GITHUB_TOKEN"
}
```

| Field | Description |
|---|---|
| `repo` | GitHub repo as `owner/repo` or a full URL |
| `branch` | Branch, tag, or commit SHA to pull from (default: `main`) |
| `remotePath` | Folder inside the repo to pull from (default: repo root) |
| `localOutput` | Local directory to write files into |
| `auth` | Set to `"env:GITHUB_TOKEN"` for private repos |

---

## Authentication

For private repositories, set a GitHub Personal Access Token:

```bash
# In your shell
export GITHUB_TOKEN=ghp_...

# Or in a .env file in your project root
GITHUB_TOKEN=ghp_...
```

SynapCLI automatically reads `GITHUB_TOKEN` from your environment or `.env`.

---

## Lockfile

After every pull, SynapCLI writes a `synap.lock.json` that records the exact commit SHA of each file pulled:

```json
{
  "agents/summarizer.md": {
    "sha": "a1b2c3d...",
    "ref": "main",
    "pulledAt": "2024-11-01T12:00:00.000Z"
  }
}
```

Commit this file to version control. It ensures reproducible pulls and powers the `diff` and `update` commands.

---

## `.gitignore` recommendation

```gitignore
.env
# don't ignore synap.lock.json — commit it!
```
