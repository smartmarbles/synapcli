# SynapCLI — Manual Test Plan

This test plan covers every capability of SynapCLI. Tests must be executed in the order listed — many tests depend on state created by earlier ones (lockfile, completion cache, config format, etc.).

**Prerequisites before starting:**
- Node.js 18+ installed
- Git installed
- A GitHub repository with at least 2–3 files to pull from (can be public)
- A GitHub token configured (for private repo tests)
- SynapCLI built and linked: `npm run build && npm link`

---

## Section 1 — Fresh State (No Config)

These tests verify behaviour when no `synap.config.json` exists yet.

### 1.1 — Version check
```bash
synap --version
```
**Expected:** Prints `1.0.0` and exits cleanly.

---

### 1.2 — Doctor before init (no config, no cache)
```bash
synap doctor
```
**Expected:**
- ✔ Node.js version check passes
- ✔ Git available
- ✖ `synap.config.json present` fails with hint to run `synap init`
- ⚠ Completion cache not found (yellow warning, not a red failure)
- Doctor exits with code 1 due to the missing config failure
- No lockfile check shown (skipped when config missing)

---

### 1.3 — Commands fail without config
```bash
synap list
synap pull
synap status
synap diff
synap update
```
**Expected:** Each command prints a clear error that `synap.config.json` was not found and suggests running `synap init`. Exits with code 2 (ConfigError).

---

## Section 2 — Init

### 2.1 — Basic init (single source, public repo)
```bash
synap init
```
**Steps:**
1. Enter a valid public GitHub repo (`owner/repo`)
2. Enter a friendly name
3. Accept default branch (`main`)
4. Leave remote path blank (root)
5. Select `Project root` from the output directory menu
6. Answer `No` to registering another repository
7. Observe token validation (if token configured) or skip
8. Answer `No` to shell completion install

**Expected:**
- `synap.config.json` created in the current directory
- Single-source flat format (not `sources` array)
- If token is configured: spinner shows "Token valid — authenticated as [username]"
- If output directory is not writable: yellow warning shown
- If no token configured: yellow warning shown
- Next steps hint shown including `synap register`

---

### 2.2 — Verify config format
```bash
cat synap.config.json
```
**Expected:** Single-source flat format:
```json
{
  "repo": "owner/repo",
  "branch": "main",
  "remotePath": "",
  "localOutput": "."
}
```

---

### 2.3 — Init with existing config (overwrite prompt)
```bash
synap init
```
**Steps:** When prompted to overwrite, select `No`.

**Expected:** "Init cancelled." message. Config file unchanged.

---

### 2.4 — Init with multiple sources
```bash
synap init
```
**Steps:**
1. Configure first source
2. Answer `Yes` to registering another repository
3. Configure second source
4. Answer `No` to registering more

**Expected:**
- `synap.config.json` written in `sources` array format
- Both sources listed in the success output

---

## Section 3 — Doctor (with config, before first pull)

### 3.1 — Doctor after init, before list
```bash
synap doctor
```
**Expected:**
- ✔ Node.js version passes
- ✔ Git available
- ✔ `synap.config.json` present
- ✔ `synap.config.json` is valid JSON
- ⚠ Completion cache not found (yellow — not an error)
- No lockfile check shown (file doesn't exist yet)
- ✔ Config sources valid
- ✔ GitHub token configured (if set)
- ✔ GitHub token valid — authenticated as [username]
- ✔ Repo accessible for each source
- ✔ Output dir writable for each source
- Final message: "All checks passed"

---

### 3.2 — Doctor with invalid token
Temporarily set an invalid token:
```bash
git config --global synapcli.githubToken ghp_invalid
synap doctor
git config --global synapcli.githubToken ghp_realtoken
```
**Expected:**
- ✖ GitHub token valid — shows error message
- Doctor exits with code 1

---

### 3.3 — Doctor with invalid JSON in config
```bash
echo "not valid json" > synap.config.json
synap doctor
```
**Expected:**
- ✖ `synap.config.json` is valid JSON fails
- Doctor stops early (no further checks)
- Exits with code 1

Restore the config before continuing:
```bash
synap init
```

---

## Section 4 — List

### 4.1 — List files
```bash
synap list
```
**Expected:**
- Spinner shows while fetching
- Files displayed with sizes
- Tip shown at the bottom
- Completion cache created at `~/.synap/completions.json`

---

### 4.2 — List JSON output
```bash
synap list --json
```
**Expected:** Raw JSON array output, no colors or formatting. Suitable for piping to other tools.

---

### 4.3 — Doctor after list (cache now exists)
```bash
synap doctor
```
**Expected:**
- ✔ Completion cache valid (N project(s) cached) — green check, no longer yellow warning

---

## Section 5 — Status (before first pull)

### 5.1 — Status with no files pulled yet
```bash
synap status
```
**Expected:**
- All files shown under "Not yet pulled" group
- Hint to run `synap pull`
- No "Up to date", "Changed", or "Missing" groups shown

---

## Section 6 — Pull

### 6.1 — Dry run
```bash
synap pull --dry-run
```
**Expected:**
- List of files that would be downloaded shown
- No files written to disk
- "No files written. Remove --dry-run to apply." shown

---

### 6.2 — Pull all files (interactive confirmation)
```bash
synap pull
```
**Steps:** When preview shows new files, confirm with `Yes`.

**Expected:**
- New files listed with `+` prefix before confirming
- Progress bar shown during download
- Files written to configured output directory
- `synap.lock.json` created
- Summary shows N file(s) written

---

### 6.3 — Verify lockfile created
```bash
cat synap.lock.json
```
**Expected:** JSON with keys in `owner/repo::path/to/file` format, each with `sha`, `ref`, and `pulledAt` fields.

---

### 6.4 — Pull specific file by name (tab completion)
```bash
synap pull <partial><TAB>
```
**Expected:** Tab completes to matching filename(s). Select one and confirm pull.

---

### 6.5 — Pull with no changes (already up to date)
```bash
synap pull
```
**Expected:** Preview shows no new files. Confirm. Summary shows 0 files written.

---

### 6.6 — Pull with --force
```bash
synap pull --force
```
**Expected:** Files pulled without preview or confirmation prompt.

---

### 6.7 — Pull interactive mode
```bash
synap pull --interactive
```
**Expected:**
- Multiselect checklist shown with all files pre-selected
- Can deselect individual files with spacebar
- Only selected files pulled after confirming

---

### 6.8 — Pull from a specific ref
```bash
synap pull --ref main
```
**Expected:** Files pulled from `main` branch regardless of what's in config.

---

### 6.9 — Conflict handling (untracked local file)
Create a file at the same path as one that would be pulled:
```bash
echo "local content" > <output-dir>/somefile.md
synap pull
```
**Expected:** Prompt asking whether to Overwrite or Skip the conflicting file. Both choices work correctly.

---

### 6.10 — CI mode pull
```bash
synap pull --ci --force
```
**Expected:**
- No colors in output
- No interactive prompts
- Plain `[OK]`, `[INFO]`, `[WARN]` prefixed lines
- Files pulled successfully

---

## Section 7 — Status (after pull)

### 7.1 — Status after full pull
```bash
synap status
```
**Expected:** All files shown under "Up to date" group. "Everything is up to date." shown.

---

### 7.2 — Status with a missing local file
Delete one of the pulled files:
```bash
rm <output-dir>/somefile.md
synap status
```
**Expected:** Deleted file appears under "Missing locally" group.

Restore it:
```bash
synap pull --force
```

---

## Section 8 — Diff

### 8.1 — Diff with no changes
```bash
synap diff
```
**Expected:** "All local files are up to date." message.

---

### 8.2 — Diff after local modification
Edit one of the pulled files locally:
```bash
echo "local change" >> <output-dir>/somefile.md
synap diff
```
**Expected:**
- Colored diff output shown (green additions, red removals)
- "N file(s) differ. Run synap update to sync." shown

Restore:
```bash
synap pull --force
```

---

### 8.3 — Diff specific file
```bash
synap diff <filename>
```
**Expected:** Only diffs the matched file(s).

---

## Section 9 — Update

### 9.1 — Update with everything up to date
```bash
synap update
```
**Expected:** "[source] All files up to date." for each source. No confirmation prompt.

---

### 9.2 — Update after local modification
Edit a pulled file, then run:
```bash
synap update
```
**Expected:**
- Changed file listed with `~` prefix in preview
- Confirmation prompt shown
- File restored to upstream version after confirming

---

### 9.3 — Update --interactive
```bash
synap update --interactive
```
**Expected:** Multiselect checklist shown for changed files. Can choose which to update.

---

### 9.4 — Update --force
```bash
synap update --force
```
**Expected:** Updates without confirmation prompt.

---

## Section 10 — Register

### 10.1 — Register a second source
```bash
synap register
```
**Steps:**
1. Enter a second valid GitHub repo
2. Answer `No` to registering more

**Expected:**
- Existing source shown before prompting
- Config migrated to `sources` array format if it was single-source
- New source appended
- Config saved

---

### 10.2 — Verify multi-source config
```bash
cat synap.config.json
```
**Expected:** `sources` array with both repos.

---

### 10.3 — Register duplicate repo
```bash
synap register
```
Enter the same repo already registered.

**Expected:** "already registered" warning shown, source skipped. Config unchanged.

---

### 10.4 — List with multiple sources
```bash
synap list
```
**Expected:** Files from both sources shown under separate headings.

---

## Section 11 — Deregister

### 11.1 — Deregister a source
```bash
synap deregister
```
**Steps:** Select one source to remove and confirm.

**Expected:**
- Source removed from config
- Orphaned lock entries for that source cleaned from `synap.lock.json`
- Note shown that local files are not deleted
- If only one source remains, config downgraded back to flat single-source format

---

### 11.2 — Verify config downgraded
```bash
cat synap.config.json
```
**Expected:** Single-source flat format (no `sources` array).

---

## Section 12 — Delete

### 12.1 — Delete dry run
```bash
synap delete --dry-run
```
**Expected:** Files listed that would be deleted. Nothing actually deleted.

---

### 12.2 — Delete specific file
```bash
synap delete <filename>
```
**Steps:** Confirm deletion when prompted.

**Expected:**
- File removed from disk
- Lock entry removed from `synap.lock.json`
- Summary shows 1 file deleted

---

### 12.3 — Delete --force
```bash
synap delete --force
```
**Expected:** Deletes all tracked files without confirmation prompt.

---

### 12.4 — Delete already-absent file
Delete a file manually, then run:
```bash
rm <output-dir>/somefile.md
synap delete
```
**Expected:** Shows "already absent" message, cleans lock entry, no error.

---

### 12.5 — Verify lock cleaned after delete
```bash
cat synap.lock.json
```
**Expected:** Deleted file's lock entry no longer present.

---

## Section 13 — Retry Failed

### 13.1 — Simulate a failed pull (no direct way to force a failure, test via lock)
Manually corrupt a lock entry SHA to simulate a mismatch, then run:
```bash
synap pull --retry-failed
```
**Expected:** "No failed files recorded" message if no prior failures exist. If failures exist, only those files are retried.

---

## Section 14 — Tab Completion

### 14.1 — Verify completion cache populated
```bash
cat ~/.synap/completions.json
```
**Expected:** JSON with your project path as key, containing array of file paths and a recent `cachedAt` timestamp.

---

### 14.2 — Tab completion on pull
```bash
synap pull <2-3 chars><TAB>
```
**Expected:** Completes to matching filename(s). If multiple matches, shows options.

---

### 14.3 — Tab completion on update, diff, delete
```bash
synap update <partial><TAB>
synap diff <partial><TAB>
synap delete <partial><TAB>
```
**Expected:** Tab completion works on all four commands.

---

### 14.4 — Tab completion on subcommands
```bash
synap <TAB>
```
**Expected:** All command names shown as completion options (init, pull, list, status, diff, update, delete, doctor, completion, register, deregister).

---

## Section 15 — Completion Command

### 15.1 — Print completion script
```bash
synap completion powershell
```
**Expected:** PowerShell script printed to stdout. No file written.

---

### 15.2 — Install completion
```bash
synap completion --install
```
**Steps:** Select your shell, confirm append.

**Expected:**
- Script appended to shell profile
- Instruction shown to reload profile

---

### 15.3 — Reinstall blocked when already installed
```bash
synap completion --install
```
**Expected:** "Completion already installed" warning. No duplicate written.

---

## Section 16 — Doctor (full state)

### 16.1 — Doctor with everything configured
```bash
synap doctor
```
**Expected:**
- ✔ Node.js version
- ✔ Git available
- ✔ `synap.config.json` present
- ✔ `synap.config.json` is valid JSON
- ✔ Completion cache valid (N project(s) cached)
- ✔ `synap.lock.json` valid (N tracked files)
- ✔ Config sources valid
- ✔ GitHub token configured
- ✔ GitHub token valid — authenticated as [username]
- ✔ Repo accessible for each source
- ✔ Output dir writable for each source
- "All checks passed. SynapCLI is ready to use."

---

### 16.2 — Doctor with corrupt lockfile
```bash
echo "not json" > synap.lock.json
synap doctor
```
**Expected:**
- ✖ `synap.lock.json` valid — shows error with hint to run `synap pull` to rebuild

Restore:
```bash
synap pull --force
```

---

### 16.3 — Doctor with corrupt completion cache
```bash
echo "not json" > ~/.synap/completions.json
synap doctor
```
**Expected:**
- ✖ Completion cache valid — shows error with hint to run `synap list` to rebuild

Restore:
```bash
synap list
```

---

## Section 17 — Postpull Hook

### 17.1 — Postpull hook fires after pull
Add a postpull hook to `synap.config.json`:
```json
{
  "repo": "owner/repo",
  "branch": "main",
  "remotePath": "",
  "localOutput": ".",
  "postpull": "echo 'postpull hook ran'"
}
```
Then run:
```bash
synap pull --force
```
**Expected:** "postpull hook ran" printed after files are written.

---

### 17.2 — Postpull hook fires after update
```bash
synap update --force
```
**Expected:** Hook runs after update completes.

---

## Section 18 — Error Handling

### 18.1 — Invalid repo in config
Edit `synap.config.json` to use a non-existent repo, then run:
```bash
synap list
```
**Expected:** GitHub API 404 error shown clearly. Exits with code 4 (NetworkError).

---

### 18.2 — No internet connection
Disconnect from the internet, then run:
```bash
synap list
```
**Expected:** Network error shown with retry attempts visible. Exits with code 4 after retries exhausted.

---

### 18.3 — Exit code verification
```bash
synap list
echo $?   # Mac/Linux
echo $LASTEXITCODE   # PowerShell
```
**Expected:** `0` on success, appropriate non-zero code on failure.

---

## Section 19 — Multi-Source End to End

### 19.1 — Full workflow with two sources
```bash
synap init   # configure two sources
synap list   # verify both sources show files
synap status # verify all files show as not-pulled
synap pull   # pull all files from both sources
synap status # verify all files show as up-to-date
synap update # verify nothing to update
```
**Expected:** Each command correctly handles both sources, labelled separately in output.

---

## Section 20 — Uninstall Cleanup

> Run this section last as it removes the global install.

### 20.1 — Verify completion and cache exist before uninstall
```bash
cat $PROFILE   # should contain SynapCLI block
cat ~/.synap/completions.json   # should exist
```

---

### 20.2 — Uninstall
```bash
npm uninstall -g synapcli
```
**Expected:**
- "Removed SynapCLI completion from [profile path]" printed
- "Removed SynapCLI cache directory ~/.synap" printed

---

### 20.3 — Verify cleanup
```bash
cat $PROFILE   # SynapCLI block should be gone
ls ~/.synap    # directory should not exist
synap --version   # should fail — command not found
```
**Expected:** All three verify the tool was fully removed.
