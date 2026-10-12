import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as core from '@actions/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

/**
 * The gate half of the entry point, and the mode dispatch. The scan half starts a container, so it is
 * driven end to end against a stub `docker` in `e2e/` instead.
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
