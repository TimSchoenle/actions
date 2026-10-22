import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  evaluateReport,
  type LookupCase,
  parseLookupCase,
  PRESET_NAME,
  presetUrl,
  type RenovateReport,
  rewritePresetReferences,
} from './lib/renovate-lookup.js';
import { renovateEntry } from './lib/renovate-tool.js';
import { ROOT_DIR } from './lib/utils.js';

const FIXTURES_DIR = path.join(ROOT_DIR, 'scripts', '__fixtures__', 'renovate');
const PRESETS_DIR = path.join(ROOT_DIR, 'configs', 'renovate');
const CASE_FILE = 'case.json';

/**
 * Dry-runs Renovate against the fixture repositories in `scripts/__fixtures__/renovate/` and checks
 * what it looks up against each fixture's `case.json`.
 *
 * The validator proves a preset is well-formed, not that it does what it is for: the preset behind
 * "Can't find version matching csp-shell-v0.2.0" validated cleanly. Only a real lookup shows that a
 * dependency resolves, moves to the right release and lands on the right branch.
 *
 * The presets are served from this checkout over a loopback HTTP server, with every
 * `github>TimSchoenle/actions//configs/renovate/<name>` reference rewritten to it, so a pull request
 * is tested against its own presets, nested `extends` included, and not against `main`.
 *
 * Arguments narrow the run to the named fixtures. Lookups hit GitHub, so `GITHUB_COM_TOKEN` (or
 * `GITHUB_TOKEN`) must hold a token; any token that can read public repositories does.
 *
 * @returns the process exit code.
 */
export async function main(argv: string[] = Bun.argv.slice(2)): Promise<number> {
  const token = process.env.GITHUB_COM_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('❌ Set GITHUB_COM_TOKEN or GITHUB_TOKEN: Renovate needs a token to look up GitHub releases.');
    return 1;
  }

  const cases = selectCases(loadCases(), argv);
  const renovate = renovateEntry('renovate');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovate-lookups-'));
  const presetsDir = path.join(workDir, 'presets');
  const server = servePresets(presetsDir);
  const baseUrl = `http://127.0.0.1:${server.port}`;

  try {
    writePresets(presetsDir, baseUrl);

    let failed = 0;
    for (const lookupCase of cases) {
      const failures = await runCase(lookupCase, { baseUrl, renovate, token, workDir });

      if (failures.length === 0) {
        console.log(`✅ ${lookupCase.name}: ${lookupCase.description}`);
      } else {
        failed++;
        console.error(`❌ ${lookupCase.name}: ${lookupCase.description}`);
        for (const failure of failures) {
          console.error(`   - ${failure}`);
        }
      }
    }

    if (failed > 0) {
      console.error(`\n❌ ${failed} of ${cases.length} Renovate lookup fixture(s) failed.`);
      return 1;
    }

    console.log(`\n✅ ${cases.length} Renovate lookup fixture(s) passed.`);
    return 0;
  } finally {
    await server.stop(true);
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function loadCases(): LookupCase[] {
  return fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const raw: unknown = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name, CASE_FILE), 'utf8'));
      return parseLookupCase(name, raw);
    });
}

function selectCases(cases: LookupCase[], names: string[]): LookupCase[] {
  if (names.length === 0) {
    return cases;
  }

  const unknown = names.filter((name) => !cases.some((lookupCase) => lookupCase.name === name));
  if (unknown.length > 0) {
    throw new Error(`Unknown fixture(s): ${unknown.join(', ')}.`);
  }

  return cases.filter((lookupCase) => names.includes(lookupCase.name));
}

/** Serves `<dir>/<name>.json` at `/<name>.json` on loopback only; every other path is a 404. */
function servePresets(dir: string): Bun.Server<undefined> {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const match = /^\/([^/]+)\.json$/.exec(new URL(request.url).pathname);
      const name = match?.[1];
      if (name === undefined || !PRESET_NAME.test(name)) {
        return new Response('Not found', { status: 404 });
      }

      const file = path.join(dir, `${name}.json`);
      if (!fs.existsSync(file)) {
        return new Response('Not found', { status: 404 });
      }

      return new Response(Bun.file(file), { headers: { 'content-type': 'application/json' } });
    },
  });
}

function writePresets(targetDir: string, baseUrl: string): void {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const file of fs.readdirSync(PRESETS_DIR).filter((name) => name.endsWith('.json'))) {
    const content = fs.readFileSync(path.join(PRESETS_DIR, file), 'utf8');
    fs.writeFileSync(path.join(targetDir, file), rewritePresetReferences(content, baseUrl));
  }
}

interface RunContext {
  baseUrl: string;
  renovate: string;
  token: string;
  workDir: string;
}

async function run(command: string[], cwd: string, env?: Record<string, string>) {
  const proc = Bun.spawn(command, {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, output: `${stdout}${stderr}` };
}

/** Builds the fixture repository: its files, a renovate.json extending the case's presets, one commit. */
async function createRepository(lookupCase: LookupCase, repoDir: string, baseUrl: string): Promise<string[]> {
  const caseDir = path.join(FIXTURES_DIR, lookupCase.name);

  for (const [destination, source] of Object.entries(lookupCase.files)) {
    const target = path.join(repoDir, destination);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(caseDir, source), target);
  }

  const config = { extends: lookupCase.presets.map((preset) => presetUrl(baseUrl, preset)) };
  fs.writeFileSync(path.join(repoDir, 'renovate.json'), `${JSON.stringify(config, null, 2)}\n`);

  // A throwaway repository in a temporary directory: identity and signing come from flags so the
  // developer's global git configuration can neither block nor sign the commit.
  const git = ['git', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false'];
  for (const command of [
    [...git, 'init', '--quiet', '--initial-branch=main'],
    [...git, 'add', '--all'],
    [
      ...git,
      '-c',
      'user.name=fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
  ]) {
    const result = await run(command, repoDir);
    if (result.exitCode !== 0) {
      return [`'${command.slice(5).join(' ')}' failed: ${result.output.trim()}`];
    }
  }

  return [];
}

async function runCase(lookupCase: LookupCase, context: RunContext): Promise<string[]> {
  const caseDir = path.join(context.workDir, 'cases', lookupCase.name);
  const repoDir = path.join(caseDir, 'repo');
  const reportPath = path.join(caseDir, 'report.json');
  const globalConfigPath = path.join(caseDir, 'global.json');
  fs.mkdirSync(repoDir, { recursive: true });

  const setupFailures = await createRepository(lookupCase, repoDir, context.baseUrl);
  if (setupFailures.length > 0) {
    return setupFailures;
  }

  // Renovate refuses, or warns about, configuration fetched from a loopback host unless a host rule
  // allows it. Scoped to the preset server's URL so nothing else gains the exemption.
  const globalConfig = { hostRules: [{ matchHost: `${context.baseUrl}/`, allowInternal: true }] };
  fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig));

  const result = await run(
    [
      'node',
      context.renovate,
      '--platform=local',
      '--dry-run=lookup',
      '--onboarding=false',
      '--require-config=required',
      '--report-type=file',
      `--report-path=${reportPath}`,
    ],
    repoDir,
    {
      GITHUB_COM_TOKEN: context.token,
      LOG_LEVEL: 'info',
      RENOVATE_BASE_DIR: path.join(context.workDir, 'renovate'),
      RENOVATE_CONFIG_FILE: globalConfigPath,
    },
  );

  if (result.exitCode !== 0 || !fs.existsSync(reportPath)) {
    return [`renovate exited with code ${result.exitCode}:\n${result.output.trim()}`];
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as RenovateReport;
  const failures = evaluateReport(lookupCase, report);
  if (failures.length > 0 && process.env.RUNNER_DEBUG === '1') {
    console.error(result.output);
  }

  return failures;
}

if (import.meta.main) {
  process.exit(await main());
}
