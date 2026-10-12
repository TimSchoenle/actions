import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import * as core from '@actions/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';
import { runContainer } from './container.js';

import type { ContainerRun } from './container.js';

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  error: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  setSecret: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('./container.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./container.js')>()),
  runContainer: vi.fn(),
}));

/**
 * Both halves of the entry point, and the mode dispatch. The scan half runs with `runContainer`
 * replaced; the container itself is driven against a stub `docker` in `e2e/`.
 */

let directory: string;
let summaryFile: string;

// `core.summary` caches the summary path after its first write, so the suite shares one file.
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'zizmor-action-'));
  summaryFile = join(directory, 'summary.md');
  await writeFile(summaryFile, '');
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  await writeFile(summaryFile, '');
  core.summary.emptyBuffer();
  vi.stubEnv('GITHUB_STEP_SUMMARY', summaryFile);
  vi.stubEnv('INPUT_MODE', 'gate');
  vi.stubEnv('INPUT_FAIL_ON_SEVERITY', 'medium');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls.map(([name, value]) => [name, String(value)]));
}

let written = 0;

async function sarifWith(...severities: string[]): Promise<string> {
  const path = join(directory, `${++written}.sarif`);
  const results = severities.map((severity, index) => ({
    ruleId: `zizmor/rule-${index}`,
    message: { text: `finding ${index}` },
    locations: [{ physicalLocation: { artifactLocation: { uri: `w${index}.yml` }, region: { startLine: index + 1 } } }],
    properties: { 'zizmor/severity': severity },
  }));

  await writeFile(path, JSON.stringify({ version: '2.1.0', runs: [{ results }] }));

  return path;
}

describe('run (gate)', () => {
  it('counts findings, fails on those at or above the threshold and writes the table', async () => {
    vi.stubEnv('INPUT_SARIF_FILE', await sarifWith('Low', 'High'));

    await run();

    expect(outputs()).toEqual({ findings: '2', failing: '1' });
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('1 zizmor finding(s) at or above medium'));

    const summary = await readFile(summaryFile, 'utf8');

    expect(summary).toContain('2 finding(s), 1 at or above <code>medium</code>.');
    expect(summary.indexOf('zizmor/rule-1')).toBeLessThan(summary.indexOf('zizmor/rule-0'));
  });

  it('passes with none, however many findings there are', async () => {
    vi.stubEnv('INPUT_FAIL_ON_SEVERITY', 'none');
    vi.stubEnv('INPUT_SARIF_FILE', await sarifWith('High', 'High'));

    await run();

    expect(outputs()).toEqual({ findings: '2', failing: '0' });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('fails on a SARIF path that does not exist, and publishes no count', async () => {
    vi.stubEnv('INPUT_SARIF_FILE', join(directory, 'missing.sarif'));

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('cannot be read'));
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails on an empty sarif_file, which the scan leaves when zizmor did not succeed', async () => {
    await run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('sarif_file: is empty'));
  });

  it('lists at most 100 findings and says how many it left out', async () => {
    vi.stubEnv('INPUT_SARIF_FILE', await sarifWith(...Array.from({ length: 120 }, () => 'High')));

    await run();

    expect(await readFile(summaryFile, 'utf8')).toContain('20 more not listed.');
    expect(vi.mocked(core.info).mock.calls.map(([line]) => line)).toContain('20 more failing finding(s) not listed.');
  });
});

describe('run (mode)', () => {
  it('refuses a mode it does not know', async () => {
    vi.stubEnv('INPUT_MODE', 'audit');

    await run();

    expect(core.setFailed).toHaveBeenCalledWith('mode: "audit" is not scan or gate.');
  });
});

describe('run (scan)', () => {
  const IMAGE = `ghcr.io/zizmorcore/zizmor:1.30.1@sha256:${'a'.repeat(64)}`;
  const TOKEN = 'ghs_unitTokenThatMustNeverBePrinted';
  const BOM = '﻿';
  const WORKFLOW = 'on: push\njobs: {}\n';
  const SARIF = JSON.stringify({ version: '2.1.0', runs: [{ results: [] }] });

  let workspace: string;
  let temp: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'zizmor-scan-ws-'));
    temp = await mkdtemp(join(tmpdir(), 'zizmor-scan-temp-'));
    await writeWorkspace({ '.github/workflows/ci.yml': WORKFLOW });

    // Every input as the composite passes it, with the defaults of action.yaml.
    vi.stubEnv('INPUT_MODE', 'scan');
    vi.stubEnv('INPUT_INPUTS', '.');
    vi.stubEnv('INPUT_PERSONA', 'pedantic');
    vi.stubEnv('INPUT_ONLINE_AUDITS', 'true');
    vi.stubEnv('INPUT_MIN_SEVERITY', '');
    vi.stubEnv('INPUT_MIN_CONFIDENCE', '');
    vi.stubEnv('INPUT_CONFIG', '');
    vi.stubEnv('INPUT_FAIL_ON_SEVERITY', 'informational');
    vi.stubEnv('INPUT_STRICT_COLLECTION', 'true');
    vi.stubEnv('INPUT_UPLOAD', 'true');
    vi.stubEnv('INPUT_TOKEN', TOKEN);
    vi.stubEnv('INPUT_IMAGE', IMAGE);
    vi.stubEnv('GITHUB_WORKSPACE', workspace);
    vi.stubEnv('RUNNER_TEMP', temp);

    containerAnswers(0, SARIF);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(temp, { recursive: true, force: true });
  });

  async function writeWorkspace(files: Record<string, string>): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(workspace, path)), { recursive: true });
      await writeFile(join(workspace, path), content);
    }
  }

  /** The container writes `sarif` where it is told, logs one line and exits with `exitCode`. */
  function containerAnswers(exitCode: number, sarif: string): void {
    vi.mocked(runContainer).mockImplementation(async (_run, sarifFile, _token, writeLog) => {
      await writeFile(sarifFile, sarif);
      writeLog('| zizmor log line');

      return { exitCode };
    });
  }

  function containerRuns(): Array<[ContainerRun, string, string | undefined]> {
    return vi
      .mocked(runContainer)
      .mock.calls.map(([containerRun, sarifFile, token]) => [containerRun, sarifFile, token]);
  }

  function annotatedFiles(annotate: typeof core.error | typeof core.warning): Array<string | undefined> {
    return vi.mocked(annotate).mock.calls.map(([, properties]) => properties?.file);
  }

  it('runs the container and publishes where the SARIF is and whether to upload it', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    let logged: unknown[];

    try {
      await run();
    } finally {
      logged = stdout.mock.calls.map(([chunk]) => chunk);
      stdout.mockRestore();
    }

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.setSecret).toHaveBeenCalledWith(TOKEN);
    expect(logged).toContain('| zizmor log line\n');

    const [[containerRun, sarifFile, token] = []] = containerRuns();

    expect(containerRun).toMatchObject({ image: IMAGE, workspace: resolve(workspace), online: true });
    expect(containerRun?.zizmorArguments).toContain('--strict-collection');
    expect(token).toBe(TOKEN);
    expect(dirname(dirname(sarifFile ?? ''))).toBe(temp);
    expect(outputs()).toEqual({ sarif_file: sarifFile, upload: 'true' });
  });

  it('annotates every file with a byte order mark and fails before the container, with strict collection', async () => {
    await writeWorkspace({ '.github/workflows/a.yml': `${BOM}${WORKFLOW}`, 'action.yml': `${BOM}name: a\n` });

    await run();

    expect(annotatedFiles(core.error)).toEqual(['.github/workflows/a.yml', 'action.yml']);
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('2 input file(s) start with a UTF-8 byte order mark'),
    );
    expect(runContainer).not.toHaveBeenCalled();
  });

  it('warns about a byte order mark and runs anyway, without strict collection', async () => {
    vi.stubEnv('INPUT_STRICT_COLLECTION', 'false');
    await writeWorkspace({ '.github/workflows/a.yml': `${BOM}${WORKFLOW}` });

    await run();

    expect(annotatedFiles(core.warning)).toEqual(['.github/workflows/a.yml']);
    expect(core.error).not.toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(runContainer).toHaveBeenCalledOnce();
  });

  it('explains a non-zero exit and publishes nothing', async () => {
    containerAnswers(3, '');

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('collected no inputs'));
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('fails closed on output that is not SARIF', async () => {
    containerAnswers(0, 'not json');

    await run();

    expect(core.setFailed).toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  it('refuses to run without RUNNER_TEMP', async () => {
    vi.stubEnv('RUNNER_TEMP', '');

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('RUNNER_TEMP is not set'));
    expect(runContainer).not.toHaveBeenCalled();
  });

  it('passes a configuration file inside the workspace to zizmor', async () => {
    vi.stubEnv('INPUT_CONFIG', 'zizmor.yml');
    await writeWorkspace({ 'zizmor.yml': 'rules: {}\n' });

    await run();

    const [[containerRun] = []] = containerRuns();

    expect(containerRun?.zizmorArguments.join(' ')).toContain('zizmor.yml');
  });

  it('redacts the token from a message that quotes a rejected input', async () => {
    vi.stubEnv('INPUT_PERSONA', TOKEN);

    await run();

    const [[message] = []] = vi.mocked(core.setFailed).mock.calls;

    expect(String(message)).toContain('***');
    expect(String(message)).not.toContain(TOKEN);
  });
});
