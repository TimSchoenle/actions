import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCases, main, selectCases, servePresets, serverUrl } from '../check-renovate-lookups.js';
import type { RenovateReport } from '../lib/renovate-lookup.js';
import type { CommandOptions, CommandResult, CommandRunner } from '../lib/renovate-tool.js';

const TOKEN = 'test-token';
const RENOVATE = '/opt/renovate/dist/renovate.js';

let root: string;
let fixturesDir: string;
let presetsDir: string;

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writeCase(name: string, overrides: Record<string, unknown> = {}): void {
  write(path.join(fixturesDir, name, 'Cargo.toml'), '[package]\nname = "fixture"\n');
  write(
    path.join(fixturesDir, name, 'case.json'),
    JSON.stringify({
      description: `The ${name} fixture.`,
      presets: ['default'],
      files: { 'crates/app/Cargo.toml': 'Cargo.toml' },
      dependencies: [{ manager: 'cargo', depName: 'csp-shell', minUpdates: 1, newValue: '^csp-shell-v' }],
      ...overrides,
    }),
  );
}

function passingReport(): RenovateReport {
  return {
    problems: [],
    repositories: {
      local: {
        problems: [],
        packageFiles: {
          cargo: [
            {
              packageFile: 'crates/app/Cargo.toml',
              deps: [{ depName: 'csp-shell', warnings: [], updates: [{ newValue: 'csp-shell-v0.2.1' }] }],
            },
          ],
        },
      },
    },
  };
}

interface Call {
  command: readonly string[];
  options: CommandOptions;
}

/**
 * Stands in for git and Renovate. Renovate's part writes `report` to the `--report-path` it is given,
 * after recording what the preset server returns for every preset the fixture's renovate.json extends.
 */
function fakeRunner(
  report: (call: Call) => RenovateReport | undefined = passingReport,
  overrides: Partial<Record<'git' | 'renovate', CommandResult>> = {},
) {
  const calls: Call[] = [];
  const served: Record<string, string> = {};

  const run: CommandRunner = async (command, options) => {
    calls.push({ command, options });

    if (command[0] === 'git') {
      return overrides.git ?? { exitCode: 0, output: '' };
    }

    const config = JSON.parse(fs.readFileSync(path.join(options.cwd, 'renovate.json'), 'utf8')) as {
      extends: string[];
    };
    for (const url of config.extends) {
      served[url] = await (await fetch(url)).text();
    }

    const reportPath = command
      .find((argument) => argument.startsWith('--report-path='))
      ?.slice('--report-path='.length);
    const content = report({ command, options });
    if (reportPath && content) {
      fs.writeFileSync(reportPath, JSON.stringify(content));
    }

    return overrides.renovate ?? { exitCode: 0, output: 'renovate log' };
  };

  return { calls, run, served };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-renovate-lookups-test-'));
  fixturesDir = path.join(root, 'fixtures');
  presetsDir = path.join(root, 'presets');
  write(
    path.join(presetsDir, 'default.json'),
    JSON.stringify({ extends: ['config:best-practices', 'github>TimSchoenle/actions//configs/renovate/base'] }),
  );
  write(path.join(presetsDir, 'base.json'), JSON.stringify({ packageRules: [] }));
  write(path.join(presetsDir, 'notes.txt'), 'not a preset');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function options(run: CommandRunner, names: string[] = []) {
  return { names, fixturesDir, presetsDir, env: { GITHUB_COM_TOKEN: TOKEN }, renovate: () => RENOVATE, run };
}

describe('main', () => {
  it('passes a fixture whose report meets its case', async () => {
    writeCase('cargo');
    const { calls, run, served } = fakeRunner();

    expect(await main(options(run))).toBe(0);
    expect(console.log).toHaveBeenCalledWith('✅ cargo: The cargo fixture.');

    const renovate = calls.find((call) => call.command[0] === 'node');
    expect(renovate?.command.slice(0, 7)).toEqual([
      'node',
      RENOVATE,
      '--platform=local',
      '--dry-run=lookup',
      '--onboarding=false',
      '--require-config=required',
      '--report-type=file',
    ]);
    expect(renovate?.options.env?.GITHUB_COM_TOKEN).toBe(TOKEN);
    expect(calls.filter((call) => call.command[0] === 'git').map((call) => call.command[5])).toEqual([
      'init',
      'add',
      '-c',
    ]);

    // The fixture extends the local server, and the preset it gets back points its own nested
    // reference at the same server instead of at GitHub.
    const [url] = Object.keys(served);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/default\.json$/);
    const preset = JSON.parse(served[url]) as { extends: string[] };
    expect(preset.extends).toEqual(['config:best-practices', url.replace('default.json', 'base.json')]);
  });

  it('places the fixture files and allows only the preset server as an internal host', async () => {
    writeCase('cargo');
    let seen: { files: string[]; global: unknown } | undefined;
    const { run } = fakeRunner(({ options: runOptions }) => {
      seen = {
        files: fs.readdirSync(path.join(runOptions.cwd, 'crates', 'app')),
        global: JSON.parse(fs.readFileSync(runOptions.env?.RENOVATE_CONFIG_FILE ?? '', 'utf8')),
      };
      return passingReport();
    });

    expect(await main(options(run))).toBe(0);
    expect(seen?.files).toEqual(['Cargo.toml']);
    expect(seen?.global).toEqual({
      hostRules: [{ matchHost: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/), allowInternal: true }],
    });
  });

  it('removes its working directory afterwards', async () => {
    writeCase('cargo');
    const { calls, run } = fakeRunner();

    await main(options(run));

    const repoDir = calls[0].options.cwd;
    expect(fs.existsSync(repoDir)).toBe(false);
  });

  it('fails a fixture with a lookup warning and reports it', async () => {
    writeCase('cargo');
    const { run } = fakeRunner(() => {
      const report = passingReport();
      const dep = report.repositories?.local.packageFiles?.cargo[0].deps?.[0];
      if (dep) {
        dep.warnings = [{ message: "Can't find version matching csp-shell-v0.2.0" }];
      }
      return report;
    });

    expect(await main(options(run))).toBe(1);
    expect(console.error).toHaveBeenCalledWith('❌ cargo: The cargo fixture.');
    expect(console.error).toHaveBeenCalledWith(
      "   - cargo csp-shell (crates/app/Cargo.toml): lookup warning: Can't find version matching csp-shell-v0.2.0",
    );
    expect(console.error).toHaveBeenCalledWith('\n❌ 1 of 1 Renovate lookup fixture(s) failed.');
  });

  it('fails when Renovate exits non-zero, with its output', async () => {
    writeCase('cargo');
    const { run } = fakeRunner(passingReport, { renovate: { exitCode: 2, output: ' boom \n' } });

    expect(await main(options(run))).toBe(1);
    expect(console.error).toHaveBeenCalledWith('   - renovate exited with code 2:\nboom');
  });

  it('fails when Renovate writes no report', async () => {
    writeCase('cargo');
    const { run } = fakeRunner(() => undefined);

    expect(await main(options(run))).toBe(1);
    expect(console.error).toHaveBeenCalledWith('   - renovate exited with code 0:\nrenovate log');
  });

  it('fails when the fixture repository cannot be created, without running Renovate', async () => {
    writeCase('cargo');
    const { calls, run } = fakeRunner(passingReport, { git: { exitCode: 128, output: 'fatal: no git\n' } });

    expect(await main(options(run))).toBe(1);
    expect(console.error).toHaveBeenCalledWith('   - git init failed: fatal: no git');
    expect(calls.some((call) => call.command[0] === 'node')).toBe(false);
  });

  it('runs only the named fixtures', async () => {
    writeCase('alpha');
    writeCase('beta');
    const { calls, run } = fakeRunner();

    expect(await main(options(run, ['beta']))).toBe(0);
    expect(calls.filter((call) => call.command[0] === 'node')).toHaveLength(1);
    expect(console.log).toHaveBeenCalledWith('✅ beta: The beta fixture.');
    expect(console.log).not.toHaveBeenCalledWith('✅ alpha: The alpha fixture.');
  });

  it('accepts GITHUB_TOKEN when GITHUB_COM_TOKEN is unset', async () => {
    writeCase('cargo');
    const { calls, run } = fakeRunner();

    expect(await main({ ...options(run), env: { GITHUB_TOKEN: 'fallback' } })).toBe(0);
    expect(calls.find((call) => call.command[0] === 'node')?.options.env?.GITHUB_COM_TOKEN).toBe('fallback');
  });

  it('refuses to run without a token', async () => {
    writeCase('cargo');
    const { calls, run } = fakeRunner();

    expect(await main({ ...options(run), env: {} })).toBe(1);
    expect(calls).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Set GITHUB_COM_TOKEN or GITHUB_TOKEN'));
  });
});

describe('selectCases', () => {
  it('rejects an unknown fixture name', () => {
    writeCase('alpha');

    expect(() => selectCases(loadCases(fixturesDir), ['alpha', 'gamma'])).toThrow('Unknown fixture(s): gamma.');
  });
});

describe('loadCases', () => {
  it('loads every fixture directory in name order and ignores loose files', () => {
    writeCase('beta');
    writeCase('alpha');
    write(path.join(fixturesDir, 'README.md'), '# fixtures');

    expect(loadCases(fixturesDir).map((lookupCase) => lookupCase.name)).toEqual(['alpha', 'beta']);
  });
});

describe('servePresets', () => {
  it('serves only <name>.json files that exist', async () => {
    const dir = path.join(root, 'served');
    write(path.join(dir, 'default.json'), '{"a":1}');
    write(path.join(dir, 'secret.txt'), 'secret');
    const server = await servePresets(dir);
    const base = serverUrl(server);

    try {
      const ok = await fetch(`${base}/default.json`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toBe('application/json');
      expect(await ok.text()).toBe('{"a":1}');

      for (const pathname of [
        '/missing.json',
        '/secret.txt',
        '/Default.json',
        '/a/default.json',
        '/%2e%2e%2fsecret.json',
      ]) {
        expect((await fetch(`${base}${pathname}`)).status, pathname).toBe(404);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
