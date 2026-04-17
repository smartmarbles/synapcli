---
description: 'Cross-shell consistency rules for tab completion scripts'
applyTo: 'src/commands/completion.ts,src/lib/completionCache.ts,src/tests/commands/completion.test.ts,src/tests/completionCache.test.ts'
---

# Shell Completion — Cross-Shell Consistency

SynapCLI ships tab completion for four shells: **bash**, **zsh**, **fish**, and **PowerShell**. All four scripts live as template literals in `src/commands/completion.ts`.

## Consistency-First Design

When adding or changing completion behavior, design for all four shells at once:

1. **Start with the constraints** — before implementing in any shell, identify what each shell's completion API can and cannot do. Pick an approach that works within the most restrictive shell's limits.
2. **Same UX across shells** — users should see the same behavior regardless of shell. If a feature (e.g. clearing the command line) isn't feasible in one shell, simplify the approach for all shells rather than shipping divergent experiences.
3. **Test one, then port** — it's fine to iterate with one shell to get the UX right, but always confirm the solution is portable before committing. Avoid shell-specific tricks (e.g. bash `bind`, terminal escape sequences) that don't have equivalents elsewhere.

## Technical Constraints by Shell

| Capability | bash | zsh | fish | PowerShell |
|---|---|---|---|---|
| Replace command line from completer | No (limited workarounds) | Yes (`BUFFER=`, `zle`) | Yes (`commandline -r`) | Yes (`TabExpansion2` replacement span) |
| Print messages during completion | Yes (`>/dev/tty`) | Yes (`compadd -x`) | Yes (stderr) | No (`Write-Host` deadlocks PSReadLine) |
| Read files directly | Yes (`grep`) | Yes (`grep`) | Yes (`grep`) | Yes (`Get-Content`, `ConvertFrom-Json`) |
| Spawn processes during completion | Avoid — Node.js startup is 200-500ms | Same | Same | Same |

## Architecture

- **Plain-text cache files**: `~/.synap/completions/<md5-hash>.txt` — one filename per line, keyed by cwd hash. Shell scripts read these directly with `grep` for instant results (no Node.js process).
- **JSON cache**: `~/.synap/completions.json` — PowerShell reads this (native JSON parsing is fast). Also serves the `--get-completions` programmatic lookup.
- **Cache population**: `writeCompletionCache()` writes both JSON and text files. Called by `list`, `pull`, `update`, `init` (via `refreshCompletionCache`), `register` (via `refreshCompletionCache`), and `install` (via `refreshCompletionCache`).
- **cwdHash()**: Normalises Windows paths (`C:\Users\...`) to Unix format (`/c/Users/...`) before hashing with MD5, so Git Bash's `$PWD | md5sum` matches Node's output.

## Template Literal Escaping

Shell scripts are embedded as JavaScript template literals. Common pitfalls:

- `${...}` is a JS expression — use `\${...}` for shell variable expansion
- `\e` in a template literal is consumed by JS (becomes just `e`) — avoid terminal escape sequences
- `\n`, `\t` are consumed by JS — use `\\n`, `\\t` for literal shell escapes
- `\\` becomes `\` in the output — double-escape when the shell needs a literal backslash

## Checklist for Completion Changes

- [ ] All four shell scripts updated consistently
- [ ] No Node.js process spawned during tab completion (use `grep` / `Get-Content`)
- [ ] UX behavior is equivalent across all shells (messages, suggestions, fallbacks)
- [ ] Template literal escaping verified — no raw `\e`, `\C`, or unescaped `${}`
- [ ] `completionCache.ts` writes both JSON and `.txt` companion files
- [ ] Tests in `completion.test.ts` and `completionCache.test.ts` updated
- [ ] Rebuild, reinstall completion (`synap completion --install`), and test in at least bash and PowerShell
