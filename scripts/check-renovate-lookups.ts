import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
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
import { type CommandRunner, renovateEntry, runCommand } from './lib/renovate-tool.js';
import { ROOT_DIR } from './lib/utils.js';

import type { AddressInfo } from 'node:net';

const CASE_FILE = 'case.json';

export interface CheckLookupsOptions {
  /** Fixture names to run; all when empty. */
  names?: string[];
  fixturesDir?: string;
  presetsDir?: string;
  env?: NodeJS.ProcessEnv;
  renovate?: () => string;
  run?: CommandRunner;
}

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
export async function main({
  names = [],
  fixturesDir = path.join(ROOT_DIR, 'scripts', '__fixtures__', 'renovate'),
  presetsDir = path.join(ROOT_DIR, 'configs', 'renovate'),
  env = process.env,
  renovate = () => renovateEntry('renovate'),
  run = runCommand,
}: CheckLookupsOptions = {}): Promise<number> {
  const token = env.GITHUB_COM_TOKEN ?? env.GITHUB_TOKEN;
  if (!token) {
    console.error('❌ Set GITHUB_COM_TOKEN or GITHUB_TOKEN: Renovate needs a token to look up GitHub releases.');
    return 1;
  }

  const cases = selectCases(loadCases(fixturesDir), names);
  const renovateFile = renovate();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovate-lookups-'));
  const servedDir = path.join(workDir, 'presets');
  const server = await servePresets(servedDir);
  const context: RunContext = { baseUrl: serverUrl(server), fixturesDir, renovate: renovateFile, run, token, workDir };

  try {
    writePresets(presetsDir, servedDir, context.baseUrl);

    let failed = 0;
    for (const lookupCase of cases) {
      const failures = await runCase(lookupCase, context);

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
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export function loadCases(fixturesDir: string): LookupCase[] {
  return fs
    .readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const raw: unknown = JSON.parse(fs.readFileSync(path.join(fixturesDir, name, CASE_FILE), 'utf8'));
      return parseLookupCase(name, raw);
    });
}

export function selectCases(cases: LookupCase[], names: string[]): LookupCase[] {
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
export async function servePresets(dir: string): Promise<Server> {
  const server = createServer((request, response) => {
    const match = /^\/([^/]+)\.json$/.exec(new URL(request.url ?? '/', 'http://localhost').pathname);
    const name = match?.[1];
    const file = name !== undefined && PRESET_NAME.test(name) ? path.join(dir, `${name}.json`) : undefined;

    if (file === undefined || !fs.existsSync(file)) {
      response.writeHead(404).end('Not found');
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' }).end(fs.readFileSync(file));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  return server;
}

export function serverUrl(server: Server): string {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function writePresets(sourceDir: string, targetDir: string, baseUrl: string): void {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const file of fs.readdirSync(sourceDir).filter((name) => name.endsWith('.json'))) {
    const content = fs.readFileSync(path.join(sourceDir, file), 'utf8');
    fs.writeFileSync(path.join(targetDir, file), rewritePresetReferences(content, baseUrl));
  }
}

interface RunContext {
  baseUrl: string;
  fixturesDir: string;
  renovate: string;
  run: CommandRunner;
  token: string;
  workDir: string;
}

/** Builds the fixture repository: its files, a renovate.json extending the case's presets, one commit. */
async function createRepository(lookupCase: LookupCase, repoDir: string, context: RunContext): Promise<string[]> {
  const caseDir = path.join(context.fixturesDir, lookupCase.name);

  for (const [destination, source] of Object.entries(lookupCase.files)) {
    const target = path.join(repoDir, destination);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(caseDir, source), target);
  }

  const config = { extends: lookupCase.presets.map((preset) => presetUrl(context.baseUrl, preset)) };
  fs.writeFileSync(path.join(repoDir, 'renovate.json'), `${JSON.stringify(config, null, 2)}\n`);

  // A throwaway repository in a temporary directory: identity and signing come from flags so the
  // developer's global git configuration can neither block nor sign the commit.
  const git = ['git', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false'];
  const steps: [string, string[]][] = [
    ['git init', [...git, 'init', '--quiet', '--initial-branch=main']],
    ['git add', [...git, 'add', '--all']],
    [
      'git commit',
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
    ],
  ];
  for (const [label, command] of steps) {
    const result = await context.run(command, { cwd: repoDir });
    if (result.exitCode !== 0) {
      return [`${label} failed: ${result.output.trim()}`];
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

  const setupFailures = await createRepository(lookupCase, repoDir, context);
  if (setupFailures.length > 0) {
    return setupFailures;
  }

  // Renovate refuses, or warns about, configuration fetched from a loopback host unless a host rule
  // allows it. Scoped to the preset server's URL so nothing else gains the exemption.
  const globalConfig = { hostRules: [{ matchHost: `${context.baseUrl}/`, allowInternal: true }] };
  fs.writeFileSync(globalConfigPath, JSON.stringify(globalConfig));

  const result = await context.run(
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
    {
      cwd: repoDir,
      env: {
        GITHUB_COM_TOKEN: context.token,
        LOG_LEVEL: 'info',
        RENOVATE_BASE_DIR: path.join(context.workDir, 'renovate'),
        RENOVATE_CONFIG_FILE: globalConfigPath,
      },
    },
  );

  if (result.exitCode !== 0 || !fs.existsSync(reportPath)) {
    return [`renovate exited with code ${result.exitCode}:\n${result.output.trim()}`];
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as RenovateReport;
  return evaluateReport(lookupCase, report);
}

if (import.meta.main) {
  process.exit(await main({ names: process.argv.slice(2) }));
}
