# GitHub Copilot Instructions for SynapCLI

## Project Overview

SynapCLI (`synap`) is a Node.js CLI tool that syncs files from GitHub repositories into any project — designed for AI-assisted development teams sharing agent definitions, system prompts, copilot instructions, and other AI model assets.

## Tech Stack

- **Runtime**: Node.js ≥ 20.12.0, ESM (`"type": "module"`)
- **Language**: TypeScript 6.x, `moduleResolution: NodeNext`
- **CLI framework**: Commander.js 14.x
- **Testing**: Vitest 4.x with `@vitest/coverage-v8` — 100% coverage enforced

## Project Layout

```
src/
  index.ts           # CLI entry point — wires commands via Commander
  types.ts           # All shared TypeScript interfaces and types
  commands/          # One file per CLI command (init, pull, list, diff, update, delete, status, doctor, completion, register, deregister)
  lib/               # Core logic (config, github, filter, hooks, preview, retry, sourcePrompt, completionCache)
  utils/             # Cross-cutting utilities (logger, context, files, progress)
  tests/             # Mirror of src/ — one test file per source file
    commands/
```

Config files: `synap.config.json` (user config), `synap.lock.json` (SHA tracking).

## Code Conventions

### TypeScript
- All types are declared in `src/types.ts` — add new types there, not inline
- Use `.js` extensions on all local imports (required for ESM/NodeNext)
- Commands delegate to lib functions — keep command files thin

### Error Handling
- Use `fatal(msg, code)` from `src/utils/logger.ts` for all unrecoverable errors — it sets `process.exitCode` and throws to unwind the stack; **never call `process.exit()` directly**
- Exit codes are defined in `ExitCode` enum in `src/types.ts`

### Logging
- Use `log.*` from `src/utils/logger.ts` — never use `console.log/error` directly in commands or lib
- Output adapts automatically to CI mode via `isCI()` from `src/utils/context.ts`
- CI mode: plain text prefixes (`[INFO]`, `[OK]`, `[WARN]`, `[ERR]`, `[DRY-RUN]`)
- Interactive mode: chalk-colored symbols (`ℹ`, `✔`, `⚠`, `✖`, `◌`)

### Config & Lock
- Load config with `loadConfig()` from `src/lib/config.ts` — always normalise to `SourceConfig[]` via `resolvedSources()`
- Lock keys are namespaced: `"owner/repo::path/to/file"` — use `lockKey(repo, filePath)` to build them
- Both config and lock are loaded fresh per command invocation — do not cache at module level

### Glob Matching
- Use `picomatch.isMatch()` via `src/lib/filter.ts` — the project uses `picomatch` directly, not `micromatch`

## Adding a New Command

1. Create `src/commands/<name>.ts` exporting an async action function
2. Register it in `src/index.ts` using `program.command(...).action(...)`
3. Add types to `src/types.ts` if needed
4. Add the command name to the completions list in `src/lib/completionCache.ts`
5. Create `src/tests/commands/<name>.test.ts` with 100% coverage

## Keeping Docs in Sync

Update `README.md` when any of the following change: Node.js version requirement, installation steps, CLI commands or their flags/options, config file format (`synap.config.json`), or the overall purpose/workflow of the tool.

Update `TESTPLAN.md` when adding new commands, changing coverage requirements, or altering the test strategy for existing functionality.

## Dependency Conventions

- All dependency versions are pinned exactly (no `^` or `~`)
- `@types/*` packages: major.minor should match the corresponding package's major.minor
- **Minimise the dependency footprint** — before adding a new package:
  - If the functionality is already provided by a transitive dependency (e.g. a sub-package of something already installed), use that directly rather than adding a new top-level dependency
  - If only a single small function is needed, implement it inline rather than pulling in a package
  - New packages must justify their weight: broad functionality used in multiple places
