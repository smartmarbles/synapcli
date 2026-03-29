---
description: 'Testing strategies and standards for TypeScript applications'
applyTo: '**/*.test.ts,**/*.test.tsx,**/*.spec.ts,**/*.spec.tsx'
---

# Testing Guidelines

## Testing Standards

- 100% coverage required — branches, functions, statements, and lines — enforced by vitest thresholds
- Use Vitest as the testing framework
- Tests live in `src/tests/`, mirroring `src/` — one test file per source file
- Mock external dependencies only (GitHub API, file system); never mock internal lib functions

## Best Practices

- **Every test must contain at least one `expect(...)` assertion** – a test with no assertions always passes and provides no value; if a test has no assertion, add one or delete the test
- Clean up after tests (timers, subscriptions, event listeners)
- Ensure there is no pollution across tests and test suites
- Other test files may need to be updated beyond just the source file's corresponding test file — e.g. if you add a new error case in a lib function, you may need to add tests for that case in multiple command test files that call it

## Mocking Patterns

**GitHub API** — mock at the module level:
```ts
vi.mock('../../../lib/github.js');
```

**File system** — mock `fs` functions via `vi.spyOn` or `vi.mock('fs')` as needed.

**`fatal()` calls** — to assert a command calls `fatal()`, spy on `process.exitCode`:
```ts
const exitSpy = vi.spyOn(process, 'exitCode', 'set');
```
Then assert it was set to the expected `ExitCode` value and that the action threw.

## V8 Coverage

Use `/* v8 ignore start */` / `/* v8 ignore stop */` blocks to suppress untestable branches (e.g. OS-specific paths, defensive exhaustive checks). **Never use `/* v8 ignore next N */`** — it suppresses line/statement coverage only, not branch coverage.

## Avoiding Unnecessary Tests

After writing the initial test suite, review each test and remove it if **any** of the following are true:

- **Already implicitly covered**: A test asserts something that every other test in the suite would also fail without
- **Duplicates another test**: A separate test that only asserts what is already asserted inside another test adds nothing
- **Tests the framework, not your code**: Do not test that Commander parses a command — test what your action handler does with the parsed input
- **Trivially true by construction**: If removing the test would never catch a real regression, it should not exist

> 💡 Prefer **fewer, higher-value tests** over inflated counts. 100% coverage must be met through meaningful assertions, not redundant ones.


## Mandatory AI Agent Workflow

When writing or modifying tests, you are **not done** until ALL of the following steps are completed in order:

1. **Write the tests** – cover all branches, functions, statements, and lines
2. **Run the tests** – execute `npm run test` and confirm all tests pass with zero failures
3. **Run coverage** – execute `npm run coverage` and confirm the target file reports **100% Stmts, Branch, Funcs, and Lines**
4. **Fix any gaps** – if coverage is below 100%, add tests to cover the missing lines/branches and repeat steps 2–3
5. **Only then declare done** – do not tell the user the work is complete until steps 2 and 3 both pass

> ⚠️ Reporting test results without running coverage is **incomplete**. Always run both.
