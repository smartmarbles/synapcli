---
description: 'Checklist for adding a new CLI command to SynapCLI'
applyTo: 'src/commands/**/*.ts,src/index.ts,src/lib/completionCache.ts'
---

# Adding a New Command

1. Create `src/commands/<name>.ts` exporting an async action function
2. Register it in `src/index.ts` using `program.command(...).action(...)`
3. Add types to `src/types.ts` if needed
4. Add the command name to the completions list in `src/lib/completionCache.ts`
5. Create `src/tests/commands/<name>.test.ts` with 100% coverage
