# Contributing to SynapCLI

Thank you for your interest in contributing! This document covers everything you need to get the project running locally, understand the codebase, and submit changes.

---

## Getting Started

**Prerequisites:**
- Node.js 18+
- Git

```bash
# Clone the repo
git clone https://github.com/smartmarbles/synapcli.git
cd synapcli

# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Link globally so the synap command points to your local build
npm link

# Verify it works
synap --version
```

---

## Development Workflow

```bash
# Build after making changes
npm run build

# Run all tests
npm test

# Watch mode — re-runs tests on file changes
npm run test:watch

# Coverage report
npm run coverage
```

---

## Project Structure

```
synapcli/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── scripts/
│   └── preuninstall.mjs          # Runs on npm uninstall -g synapcli
├── templates/
│   └── sync-agents.yml           # GitHub Actions template for users
├── .github/
│   └── workflows/
│       └── ci.yml                # CI — runs build and tests on every push and PR
└── src/
    ├── index.ts                  # CLI entry point and command registration
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
    │   ├── completion.ts         # synap completion
    │   ├── register.ts           # synap register
    │   ├── deregister.ts         # synap deregister
    │   └── uninstall.ts          # cleanup helper (used by preuninstall.mjs)
    ├── lib/
    │   ├── github.ts             # GitHub API client (retry, rate limits)
    │   ├── config.ts             # Config and lockfile read/write
    │   ├── filter.ts             # Glob pattern filtering
    │   ├── hooks.ts              # Post-pull hook runner
    │   ├── preview.ts            # Status preview and interactive selection
    │   ├── completionCache.ts    # Tab completion cache (~/.synap/completions.json)
    │   ├── sourcePrompt.ts       # Shared source configuration wizard
    │   └── retry.ts              # Exponential backoff retry
    ├── utils/
    │   ├── files.ts              # Local file read/write/delete operations
    │   ├── logger.ts             # CI-aware colored terminal output
    │   ├── progress.ts           # Progress bar (degrades gracefully in CI)
    │   └── context.ts            # Global CI mode flag
    └── tests/
        ├── config.test.ts
        ├── files.test.ts
        ├── filter.test.ts
        ├── retry.test.ts
        └── completionCache.test.ts
```

---

## Adding a New Command

1. Create `src/commands/yourcommand.ts` and export an async function following the pattern of existing commands
2. Import and register it in `src/index.ts`
3. Add any new option interfaces to `src/types.ts`
4. Add tests in `src/tests/`
5. Document it in `README.md` under the Commands section

---

## Submitting a Pull Request

1. Fork the repo and create a branch from `main`
2. Make your changes and ensure `npm test` passes
3. Ensure `npm run build` compiles without errors
4. Open a pull request with a clear description of what changed and why

---

## .gitignore

```gitignore
node_modules/
dist/
coverage/
# Do NOT ignore synap.lock.json — commit it
```
