# SynapCLI — Real-world Examples

## Pulling AI assets from multiple community sources

One of the most powerful ways to use SynapCLI is to aggregate AI assets — agent definitions, skills, system prompts, coding instructions — from several community-maintained GitHub repositories into a single project. Each source is independent: different repos, different remote paths, different local destinations.

### Discovering sources

Sites like **[skills.sh](https://skills.sh)** and community GitHub organisations (e.g. [awesome-copilot](https://github.com/github/awesome-copilot)) publish curated prompts, skill definitions, and instruction files that you can use directly. When you find one you want, copy the GitHub URL or the `owner/repo` slug shown on the page — `synap register` accepts either form and figures out the rest.

```
https://github.com/anthropics/skills
https://github.com/awesome-copilot/copilot-instructions
smartmarbles/helm
```

> **GitHub repositories only.** SynapCLI works exclusively with GitHub repos — it relies on the GitHub API to traverse folder structure and track exact per-file commit SHAs, which is what powers `status`, `diff`, and change detection. A generic URL to a website or file host won't work.

### Registering sources interactively

```bash
synap register   # repeat for each source you want to add
```

Each `synap register` run asks for a repo, the remote sub-folder to pull from, and a local output directory. You end up with a config like this:

```json
{
  "sources": [
    {
      "name": "Claude Skills",
      "repo": "anthropics/skills",
      "branch": "main",
      "remotePath": "skills",
      "localOutput": ".claude/skills",
      "include": ["**/*.md"]
    },
    {
      "name": "Copilot Instructions",
      "repo": "awesome-copilot/copilot-instructions",
      "branch": "main",
      "remotePath": "instructions",
      "localOutput": ".github/instructions"
    },
    {
      "name": "Copilot Prompts",
      "repo": "awesome-copilot/copilot-instructions",
      "branch": "main",
      "remotePath": "prompts",
      "localOutput": ".github/prompts"
    },
    {
      "name": "Helm Agents",
      "repo": "smartmarbles/helm",
      "branch": "main",
      "remotePath": "agents",
      "localOutput": ".github/agents"
    }
  ]
}
```

### Importing sources from a collection file

Instead of adding sources one at a time, you can import a pre-built **collection file** — a JSON file with a `sources[]` array that someone on your team (or the community) has curated. This is the fastest way to onboard a new project:

```bash
# Import from a local file
synap register --from ./team-agents.collection.json

# Import from a GitHub repo using shorthand
synap register --from acme-org/ai-collections/react-stack.collection.json

# Import from a raw GitHub URL
synap register --from https://raw.githubusercontent.com/acme-org/ai-collections/main/react-stack.collection.json

# Skip the localOutput prompts — accept defaults
synap register --from ./team-agents.collection.json --yes

# Fetch the collection from a specific branch or tag
synap register --from acme-org/ai-collections/react-stack.collection.json --ref v2
```

SynapCLI detects duplicates (same repo + remotePath + branch), resolves name conflicts interactively, and backs up your existing config before merging. Each imported source is tagged with `_importedFrom` so you can trace where it came from.

A collection file is just a JSON file with a `sources[]` array:

```json
{
  "sources": [
    {
      "name": "Claude Skills",
      "repo": "anthropics/skills",
      "branch": "main",
      "remotePath": "skills",
      "localOutput": ".claude/skills"
    },
    {
      "name": "Copilot Instructions",
      "repo": "awesome-copilot/copilot-instructions",
      "branch": "main",
      "remotePath": "instructions",
      "localOutput": ".github/instructions"
    }
  ]
}
```

Share these with your team in a shared drive, a GitHub repo, or as a link in your onboarding docs.

### Creating an asset collection

If you want to share **specific files** rather than entire repo sources, use `synap collection create`. This reads your lockfile and lets you hand-pick exactly which tracked files to bundle:

```bash
synap collection create react-kit
```

```
SynapCLI — Create Collection

Select files to include:
  ✔ anthropics/skills :: skills/summarise.md              → .claude/skills
  ✔ awesome-copilot/copilot-instructions :: react.md      → .github/instructions
  ◻ awesome-copilot/copilot-instructions :: python.md     → .github/instructions
  ✔ acme-org/tools :: scripts/lint-components.py          → scripts

Collection name: React Development Kit
Description: Curated React assets for new team members

✔ Wrote react-kit.collection.json (3 assets)
```

The output file is an **asset collection** — it lists individual files, not repo sources. Consumers install it with `synap install`:

```bash
synap install react-kit.collection.json
```

On first install, the consumer is prompted to choose their development system (Copilot, Claude, Gemini, Codex). This remaps output directories automatically — e.g., your `.github/skills` default becomes `.claude/skills` for a Claude user. The preset is saved to config and never asked again.

For CI or non-interactive use:

```bash
synap collection create react-kit --json > react-kit.collection.json
synap install react-kit.collection.json --yes --preset claude
```

### First pull — choose exactly what you want

Unlike tools that clone an entire repository, SynapCLI lets you be selective. Browse what's available first, then pull only what you need:

```bash
synap list                          # see everything across all sources
synap list --source "Claude Skills" # browse a single source
```

Pull a specific file by name:

```bash
synap pull skills/skill-creator       # pulls the skill-creator skill from Claude Skills
synap pull testing.instructions.md    # pulls the testing instructions file
```

Or use interactive mode to pick from a checklist. Every checklist includes a **Select / Deselect All** toggle at the top — checking it selects all files if not all are ticked, or clears all if they are. When multiple sources are registered, each source is shown with a label and a progression counter (e.g. `[Claude Skills] (1/4)`) — deselecting all files or pressing Escape on one source skips it and moves to the next:

```bash
synap pull --interactive
```

When you're ready to seed everything at once:

```bash
synap pull
```

Either way, SynapCLI writes each file to its configured local directory and records the exact commit SHA in `synap.lock.json`. Commit the lockfile so your whole team is on identical versions.

### Two weeks later — see what the community changed

```bash
synap status
```

```
Changed upstream (3):
  ~ .github/instructions/react.md         (Copilot Instructions)
  ~ .github/prompts/explain-code.md       (Copilot Prompts)
  ~ .claude/skills/summarise.md           (Claude Skills)
Up to date (22):
  ...
```

Before accepting any updates, inspect exactly what changed:

```bash
synap diff
```

This prints a colored line-by-line diff for every upstream change — just like reviewing a PR. Once you're happy:

```bash
synap update
```

Only the two changed files are downloaded. Everything else is untouched.

### Pinning to a stable release

If a community repo cuts versioned releases, you can pin:

```bash
synap pull --ref v2.1.0
```

This pulls all sources at that ref. Useful for release branches where you want reproducible, reviewed assets rather than latest.

### Keeping sources in sync in CI

Add `synap update --ci --force` to your GitHub Actions workflow (see the ready-made template at `templates/sync-agents.yml`). On every run it checks all registered sources and commits any changed files back to your repo — so your whole team automatically inherits upstream improvements.

---

## Tips

- **Same repo, different paths** — Register the same repository twice with different `remotePath` and `localOutput` values to pull from different subdirectories independently.
- **Per-source filtering** — Each source supports `include` and `exclude` patterns so you can limit what gets pulled. For example, `"**/*.md"` means "only Markdown files, anywhere in the folder". This is useful when a repo contains a mix of file types and you only want certain ones.
- **Named sources** — The `name` field is used in `synap status` and `synap list --source` output. Choose names that are meaningful to your team.
- **Scoped listing** — `synap list --source "Claude Skills"` browses only that source's files without affecting the others.
- **Asset collections** — Use `synap collection create` to bundle specific files into a shareable collection, and `synap install` to consume them. Unlike `register --from` (which shares repo sources), asset collections share individual hand-picked files with automatic preset remapping.
