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
  commands/          # One file per CLI command (init, pull, list, diff, update, delete, status, doctor, completion, register, deregister, uninstall)
  lib/               # Core logic (config, github, filter, hooks, preview, retry, sourcePrompt, completionCache)
  utils/             # Cross-cutting utilities (logger, context, files, progress)
  tests/             # Mirror of src/ — one test file per source file
                     # Root-level test files cover lib/ and utils/ modules
    commands/        # One test file per command
```

Config files: `synap.config.json` (user config), `synap.lock.json` (SHA tracking).

Other top-level directories: `scripts/` (npm lifecycle scripts), `templates/` (workflow templates), `testplans/` (manual test plans).

## Code Conventions

### TypeScript
- Types used only within a single file may be declared inline; types shared across modules belong in `src/types.ts`
- Use `.js` extensions on all local imports (required for ESM/NodeNext)
- Commands delegate to lib functions — keep command files thin

### Error Handling
- Use `fatal(msg, code)` from `src/utils/logger.ts` for all unrecoverable errors — it calls `log.error()`, sets `process.exitCode`, and throws to unwind the stack; **never call `process.exit()` directly for error exits**
- `process.exit(0)` is acceptable for clean user-cancellation flows (e.g. user presses Escape in a prompt)
- Exit codes are defined in `ExitCode` enum in `src/types.ts`

### Logging
- Use `log.*` from `src/utils/logger.ts` for status/progress messages — never use `console.log/error` directly for these
- Use `console.log()` for structured content output (file listings, JSON output, diffs, blank-line spacing between sections) — this is an established pattern throughout all commands
- Output adapts automatically to CI mode via `isCI()` from `src/utils/context.ts`

### Config & Lock
- Load config with `loadConfig()` from `src/lib/config.ts` — always normalise to `SourceConfig[]` via `resolvedSources()`
- Lock keys are namespaced: `"owner/repo::path/to/file"` — use `lockKey(repo, filePath)` to build full keys; prefix-only lookups (e.g. `key.startsWith(\`${repo}::\`)`) are acceptable since `lockKey()` cannot produce a prefix string
- Both config and lock are loaded fresh per command invocation — do not cache at module level
- Exception: `doctor.ts` reads config/lock raw JSON via `readFileSync` for syntax validation before calling `loadConfig()` — this is intentional for health-check semantics

### Glob Matching
- Use `picomatch.isMatch()` via `src/lib/filter.ts` — the project uses `picomatch` directly, not `micromatch`

## Keeping Docs in Sync

Update `README.md` and `Examples.md`when any of the following change: Node.js version requirement, installation steps, CLI commands or their flags/options, config file format (`synap.config.json`), or the overall purpose/workflow of the tool.

Update `TESTPLAN.md` when adding new commands, changing coverage requirements, or altering the test strategy for existing functionality.

Update `testplans/CROSSPLATFORM-TESTPLAN.md` when adding new OS/shell combinations to the test matrix, when new commands require smoke-test coverage, or when prerequisites change.

## Implementation Workflow

Implementation is not complete until **all source files have zero compiler or lint errors**. After writing or editing any source file, run `get_errors` on it and fix all issues before moving on.

Resolve all errors in implementation files **before** writing unit tests. Writing tests against broken source code wastes effort and produces misleading failures.
