import ora from 'ora';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig, parseRepoString, resolvedSources, CONFIG_FILE } from '../lib/config.js';
import { validateToken, hasToken, listRepoContents } from '../lib/github.js';
import { isDirWritable } from '../utils/files.js';
import { log } from '../utils/logger.js';

interface CheckResult {
  label: string;
  ok: boolean;
  warn?: boolean;
  detail?: string;
}

function check(label: string, ok: boolean, detail?: string): CheckResult {
  return { label, ok, detail };
}

function caution(label: string, detail?: string): CheckResult {
  return { label, ok: true, warn: true, detail };
}

export async function doctorCommand(): Promise<void> {
  log.title('SynapCLI — Doctor');
  console.log();

  const results: CheckResult[] = [];

  // ── Node version ───────────────────────────────────────────────────────────
  const nodeVersion = process.versions.node;
  const [major] = nodeVersion.split('.').map(Number);
  results.push(check(
    `Node.js version (${nodeVersion})`,
    major >= 18,
    /* v8 ignore next */
    major < 18 ? 'Node.js 18+ is required' : undefined
  ));

  // ── Git available ──────────────────────────────────────────────────────────
  let gitVersion = '';
  try {
    gitVersion = execSync('git --version', { encoding: 'utf8' }).trim();
    results.push(check(`Git available (${gitVersion})`, true));
  } catch {
    results.push(check('Git available', false, 'git is not installed or not in PATH'));
  }

  // ── Config file ────────────────────────────────────────────────────────────
  const configPath = join(process.cwd(), CONFIG_FILE);
  const configExists = existsSync(configPath);
  results.push(check(
    `${CONFIG_FILE} present`,
    configExists,
    configExists ? undefined : `Run ${chalk.white('synap init')} to create it`
  ));

  if (!configExists) {
    printResults(results);
    return;
  }

  // ── Config valid JSON ──────────────────────────────────────────────────────
  try {
    JSON.parse(readFileSync(configPath, 'utf8'));
    results.push(check(`${CONFIG_FILE} is valid JSON`, true));
  } catch {
    results.push(check(`${CONFIG_FILE} is valid JSON`, false, 'File contains invalid JSON'));
    printResults(results);
    return;
  }

  // ── Completion cache ───────────────────────────────────────────────────────
  const cacheFile = join(homedir(), '.synap', 'completions.json');
  if (existsSync(cacheFile)) {
    try {
      const cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
      const projectCount = Object.keys(cache).length;
      results.push(check(`Completion cache valid (${projectCount} project(s) cached)`, true));
    } catch {
      results.push(check('Completion cache valid', false, `Corrupted cache at ${cacheFile} — run synap list to rebuild it`));
    }
  } else {
    results.push(caution('Completion cache not found', 'Run synap list to enable tab completion'));
  }

  // ── Lockfile ───────────────────────────────────────────────────────────────
  const lockPath = join(process.cwd(), 'synap.lock.json');
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      const trackedCount = Object.keys(lock).filter((k) => !k.endsWith('::__failed__')).length;
      results.push(check(`synap.lock.json valid (${trackedCount} tracked file(s))`, true));
    } catch {
      results.push(check('synap.lock.json valid', false, 'File contains invalid JSON — run synap pull to rebuild it'));
    }
  }

  // ── Sources resolvable ─────────────────────────────────────────────────────
  let sources;
  try {
    sources = resolvedSources(loadConfig());
    results.push(check(`Config sources valid (${sources.length} source(s))`, true));
  } catch (err) {
    results.push(check('Config sources valid', false, (err as Error).message));
    printResults(results);
    return;
  }

  // ── GitHub token ───────────────────────────────────────────────────────────
  const tokenFound = hasToken();
  results.push(check(
    'GitHub token configured',
    tokenFound,
    tokenFound
      ? undefined
      : `Set via env GITHUB_TOKEN or run: git config --global synapcli.githubToken <token>`
  ));

  if (tokenFound) {
    const spinner = ora('Validating GitHub token…').start();
    try {
      const username = await validateToken();
      spinner.stop();
      results.push(check(`GitHub token valid (authenticated as ${chalk.bold(username)})`, true));
    } catch (err) {
      spinner.stop();
      results.push(check('GitHub token valid', false, (err as Error).message));
    }
  }

  // ── Per-source checks ──────────────────────────────────────────────────────
  for (const source of sources) {
    /* v8 ignore next */
    const label = source.name ?? source.repo;

    const repoSpinner = ora(`Checking repo access: ${label}…`).start();
    try {
      const { owner, repo } = parseRepoString(source.repo);
      await listRepoContents({ owner, repo, path: source.remotePath || '', ref: source.branch });
      repoSpinner.stop();
      results.push(check(`Repo accessible: ${label}`, true));
    } catch (err) {
      repoSpinner.stop();
      results.push(check(`Repo accessible: ${label}`, false, (err as Error).message));
    }

    const writable = isDirWritable(source.localOutput);
    results.push(check(
      `Output dir writable: ${source.localOutput}`,
      writable,
      writable ? undefined : `Cannot write to ${source.localOutput}`
    ));
  }

  printResults(results);

  const failed = results.filter((r) => !r.ok && !r.warn);
  if (failed.length === 0) {
    console.log();
    log.success('All checks passed. SynapCLI is ready to use.');
  } else {
    console.log();
    log.warn(`${failed.length} check(s) failed. Fix the issues above and re-run ${chalk.white('synap doctor')}.`);
    process.exit(1);
  }
}

function printResults(results: CheckResult[]): void {
  for (const r of results) {
    const icon  = r.warn ? chalk.yellow('⚠') : r.ok ? chalk.green('✔') : chalk.red('✖');
    const label = r.warn ? chalk.yellow(r.label) : r.ok ? chalk.white(r.label) : chalk.red(r.label);
    console.log(`  ${icon} ${label}`);
    if (r.detail) {
      console.log(`      ${chalk.dim(r.detail)}`);
    }
  }
}
