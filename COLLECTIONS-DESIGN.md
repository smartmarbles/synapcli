# SynapCLI — Collections Feature Design

## Problem

Sharing repo configs (`synap.config.json` / `register --from`) is already solved. What's missing is sharing a **curated set of specific files** across repos. A React expert shouldn't have to say "register these 3 repos and figure out which files to pull" — they should be able to say "here are the 7 exact files you need."

Collections are **asset-level sharing** — individual files from one or more repos, hand-picked by an author.

---

## Two New Commands

### `synap collection create <name>`

Author-side. Writes `<name>.collection.json` to the current directory.

**Interactive flow:**

1. Reads `synap.lock.json` — shows all tracked files as a multiselect checklist
2. Author picks the files they want in the collection
3. Prompts for a name and optional description
4. Each selected file already has `repo`, `branch`, `path`, and `localOutput` from the config/lockfile — no extra input needed
5. Writes the collection file

```bash
synap collection create react-kit
```

```
SynapCLI — Create Collection

Collection name: React Development Kit
Description: Curated assets for React development

Select files to include:
  ◻ Select / Deselect All
  ✔ acme/ai-agents :: skills/frontend-design/SKILL.md        → .github/skills
  ✔ acme/ai-agents :: instructions/react.instructions.md     → .github/instructions
  ✔ community/standards :: typescript.instructions.md         → .github/instructions
  ◻ community/standards :: python.instructions.md             → .github/instructions
  ✔ acme/tools :: agents/react-reviewer.agent.md              → .github/agents
  ✔ acme/tools :: scripts/lint-components.py                  → scripts

✔ Wrote react-kit.collection.json (5 assets)
```

**Flags:**

- `--json` — output to stdout instead of writing a file (for piping)

### `synap install <source>`

Consumer-side. Downloads specific files from a collection.

**Source formats** (same as existing `--from`):

- Local file: `./react-kit.collection.json`
- GitHub shorthand: `org/repo/react-kit.collection.json`
- Raw URL: `https://raw.githubusercontent.com/...`

**Interactive flow:**

1. Load and validate collection
2. If no `preset` in `synap.config.json`, prompt for system (saved to config — only asked once):
   ```
   Which development system are you using?
     ● GitHub Copilot (.github/)
     ○ Claude Code (.claude/)
     ○ Gemini Code Assist (.gemini/)
     ○ OpenAI Codex (.agents/)
     ○ Other / no remapping
   ```
3. Apply preset remapping to `defaultOutput` values
4. Group assets by resolved output path, prompt once per group:
   ```
   React Development Kit — 5 assets

     .claude/skills (1 file)
       frontend-design/SKILL.md
     → [.claude/skills]: Enter

     .claude/instructions (2 files)
       react.instructions.md
       typescript.instructions.md
     → [.claude/instructions]: Enter

     scripts (1 file)
       lint-components.py
     → [scripts]: Enter

   Confirm install? [Y/n]
   ```
5. Download each file, write to disk, update lockfile
6. Store collection definition entry in lockfile (`_collection::Name` key with origin, pathOverrides, and SHA)

**Flags:**

- `--yes` — accept all resolved paths without prompting (skips system prompt too if preset already set)
- `--preset <name>` — override stored preset for this install
- `--dry-run` — show what would be installed without writing

---

## Collection File Format

```json
{
  "name": "React Development Kit",
  "description": "Curated assets for React development",
  "assets": [
    {
      "repo": "acme/ai-agents",
      "branch": "main",
      "path": "skills/frontend-design/SKILL.md",
      "defaultOutput": ".github/skills"
    },
    {
      "repo": "acme/ai-agents",
      "branch": "main",
      "path": "instructions/react.instructions.md",
      "defaultOutput": ".github/instructions"
    },
    {
      "repo": "community/standards",
      "branch": "main",
      "path": "typescript.instructions.md",
      "defaultOutput": ".github/instructions"
    },
    {
      "repo": "acme/tools",
      "branch": "main",
      "path": "agents/react-reviewer.agent.md",
      "defaultOutput": ".github/agents"
    },
    {
      "repo": "acme/tools",
      "branch": "main",
      "path": "scripts/lint-components.py",
      "defaultOutput": "scripts"
    }
  ]
}
```

### Asset fields

| Field | Required | Description |
|---|---|---|
| `repo` | Yes | `owner/repo` |
| `branch` | Yes | Branch, tag, or SHA |
| `path` | Yes | Full path to file within the repo |
| `defaultOutput` | Yes | Creator's suggested local directory |

### Top-level fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Human-readable name for the collection |
| `description` | No | Short description of what the collection provides |
| `assets` | Yes | Array of asset objects |

---

## Preset System

### What presets do

Presets change the **default suggestion** shown in the output-path prompt. They don't silently remap anything — the user always sees the resolved path and can override it.

### How presets are stored

`synap.config.json` gains one new optional field:

```json
{
  "preset": "claude",
  "sources": [...]
}
```

Prompted on first `synap install` if missing. Saved to config. Never asked again.

### Preset resolution order (highest priority wins)

1. `--preset claude` flag (explicit override)
2. `synap.config.json` `"preset"` field (project setting)
3. Interactive prompt on first install (saves to config)

### Preset definitions

Presets are path-to-path mappings. Most systems use a simple prefix swap. Systems with non-standard layouts (like Codex) get explicit path mappings.

```typescript
const PRESETS: Record<string, Record<string, string>> = {
  copilot: {},  // defaultOutput is assumed Copilot-style — no remapping needed
  claude: {
    '.github': '.claude',
  },
  gemini: {
    '.github': '.gemini',
  },
  codex: {
    '.github/skills': '.agents/skills',
    '.github/instructions': '.',
    '.github/agents': '.agents/skills',
  },
};
```

### Remapping algorithm

For each asset's `defaultOutput`:

1. Check if an exact match exists in the preset map → use the mapped value
2. Check if `defaultOutput` starts with a preset key (prefix match) → swap the prefix
3. No match → pass through unchanged (use creator's default)

Longest prefix match wins to avoid `.github` matching when `.github/skills` has its own mapping (relevant for Codex).

Example with `--preset claude`:

| Creator's `defaultOutput` | Resolved default | Rule |
|---|---|---|
| `.github/skills` | `.claude/skills` | Prefix swap: `.github` → `.claude` |
| `.github/instructions` | `.claude/instructions` | Prefix swap: `.github` → `.claude` |
| `scripts` | `scripts` | No match — pass through |

Example with `--preset codex`:

| Creator's `defaultOutput` | Resolved default | Rule |
|---|---|---|
| `.github/skills` | `.agents/skills` | Exact match |
| `.github/instructions` | `.` | Exact match |
| `.github/agents` | `.agents/skills` | Exact match |
| `scripts` | `scripts` | No match — pass through |

---

## Known AI System Folder Structures

Reference for preset definitions and documentation.

### GitHub Copilot

| Asset type | Location |
|---|---|
| Instructions | `.github/instructions/*.instructions.md` |
| Prompts | `.github/prompts/*.prompt.md` |
| Agents | `.github/agents/*.agent.md` |
| Skills | `.github/skills/<name>/SKILL.md` |
| Copilot instructions | `.github/copilot-instructions.md` |

### Claude Code

| Asset type | Location |
|---|---|
| Instructions | `.claude/instructions/*.md` |
| Agents | `.claude/agents/*.md` |
| Skills | `.claude/skills/<name>/SKILL.md` |
| Settings | `.claude/settings.json` |

### Gemini Code Assist

| Asset type | Location |
|---|---|
| Instructions | `.gemini/instructions/*.md` |
| Settings | `.gemini/settings.json` |

### OpenAI Codex

| Asset type | Location |
|---|---|
| Instructions | `AGENTS.md` at repo root (+ nested per-directory) |
| Global instructions | `~/.codex/AGENTS.md` |
| Skills | `.agents/skills/<name>/SKILL.md` (scanned from CWD up to repo root) |
| User skills | `$HOME/.agents/skills/` |
| Hooks | `hooks/` or `hooks.json` |
| MCP config | `.github/mcp.json` |
| Config | `~/.codex/config.toml` |

---

## Config Changes

### New `preset` field

```json
{
  "preset": "claude",
  "sources": [...]
}
```

No other config changes. Collection tracking lives entirely in the lockfile — configs are shared between people, so putting collection lock data there would cause confusion.

---

## Lockfile Changes

Everything is tracked in `synap.lock.json`. Two types of entries coexist:

### Individual file entries

Files installed from a collection are tracked like any other file, with an optional `collection` tag:

```json
{
  "acme/ai-agents::skills/frontend-design/SKILL.md": {
    "sha": "a1b2c3d...",
    "ref": "main",
    "pulledAt": "2026-04-14T12:00:00.000Z",
    "collection": "React Development Kit"
  }
}
```

The `collection` field is optional. Existing lock entries from `synap pull` don't have it. Backward compatible.

### Collection definition entries

The collection definition itself is stored in the lockfile under a `_collection::` namespaced key, with its SHA for change detection:

```json
{
  "_collection::React Development Kit": {
    "sha": "def456...",
    "ref": "main",
    "pulledAt": "2026-04-14T12:00:00.000Z",
    "origin": "org/repo/react-kit.collection.json",
    "pathOverrides": {
      ".github/skills": ".claude/skills",
      ".github/instructions": ".claude/instructions",
      ".github/agents": ".claude/agents"
    }
  }
}
```

- `origin` — where the collection was fetched from (same formats as `synap install` source)
- `pathOverrides` — resolved output mappings (creator default → consumer actual) so updates don't re-prompt
- `sha` — SHA of the collection definition file itself, enabling change detection on re-install

The `_collection::` prefix distinguishes these from regular `owner/repo::path` file entries.

---

## How Existing Commands Interact

| Command | Behavior with collection-installed files |
|---|---|
| `synap status` | Shows them grouped under collection name |
| `synap diff` | Works — file is in lockfile with repo + sha |
| `synap update` | Works — checks upstream sha like any tracked file |
| `synap delete` | Works — removes file + lock entry |
| `synap pull` | Ignores them (they're not tied to a registered source) |
| `synap install --update <source>` | Re-fetches collection definition, adds new assets, updates changed ones |

---

## Update Story

Two levels of updates:

- **File-level:** `synap update` handles SHA-level changes (file content changed upstream). Already works via lockfile — no new code needed.
- **Collection-level:** `synap install --update <source>` re-fetches the collection definition and adds new assets the author added since the last install. Uses `pathOverrides` from the `_collection::` lockfile entry to apply the same folder mapping without re-prompting.

---

## User Experience Examples

### Copilot user, accepts all defaults

```bash
synap install react-kit.collection.json --yes
```

Defaults accepted as-is. 4 files written. No prompts.

### Claude user, first install

```bash
synap install react-kit.collection.json
```

Prompted for system (selects Claude → saved to config), then prompted per output group with `.claude/*` defaults pre-filled. 4 prompts for 4 groups, Enter to accept each.

### Claude user, subsequent installs

Preset already saved. Defaults pre-filled as `.claude/*`. With `--yes`, zero prompts.

### Codex user

```bash
synap install react-kit.collection.json --preset codex
```

Skills → `.agents/skills/`, instructions → `.` (root), agents → `.agents/skills/`. Each shown as the default in the prompt. User confirms or overrides.

---

## Implementation Plan

| Phase | What | Files |
|---|---|---|
| **1** | Types: `CollectionAsset`, `CollectionFile`, `preset` on `SynapConfig`, extended `LockEntry` with `origin`/`pathOverrides` | `types.ts` |
| **2** | Preset definitions + remapping logic | `lib/presets.ts` (new) |
| **3** | Collection file validation (extend existing `collection.ts`) | `lib/collection.ts` |
| **4** | `synap install` command | `commands/install.ts` (new), `index.ts` |
| **5** | `synap collection create` command | `commands/collection.ts` (new), `index.ts` |
| **6** | Update existing commands for collection awareness (`status` grouping, `delete` cleanup) | `commands/status.ts`, `commands/delete.ts` |
| **7** | Tests (100% coverage) + prune redundant/low-value tests | `tests/commands/install.test.ts`, `tests/commands/collection.test.ts`, `tests/presets.test.ts`, extend existing |
| **8** | Docs | README, EXAMPLES, TESTPLAN, CROSSPLATFORM-TESTPLAN |

---

## What Doesn't Change

- `synap register` / `register --from` — still works for repo-level config sharing
- `synap pull` — still works for source-registered files
- Lockfile format — backward compatible (new `collection` field is optional)
- Existing `collection.ts` code — `parseCollectionOrigin` and `loadCollection` get extended, not replaced

---

## Open Questions

1. **Should `synap init` also prompt for preset?** Saves time if the user installs a collection later. But adds a question to init that might not be relevant yet.
2. **Collection versioning** — should the collection file support a `version` field? Could be useful for marketplace discovery later but isn't needed for v1.
3. **Should `synap install` auto-register sources?** When a collection references repos not in `sources[]`, should they be added? Probably not — collection assets are tracked independently in the lockfile and don't need a registered source.
4. **Folder creation** — if the consumer maps skills to `.claude/skills/` but that directory doesn't exist, create it automatically? (Probably yes — `synap pull` already does this.)
