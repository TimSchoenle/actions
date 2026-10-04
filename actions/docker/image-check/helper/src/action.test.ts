import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as core from '@actions/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';
import { BYTES_PER_MIB } from './gates.js';

import type { ActionDependencies } from './action.js';
import type { CommandResult } from './docker.js';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading and the step summary stay
 * real, so these exercise the manifest's own input names and what actually lands in the summary.
 */
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  notice: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));

const REPOSITORY = 'acme/app';

const MEASURE_INPUTS: Record<string, string> = {
  image: 'app:test',
  platform: 'linux/amd64',
  size_warning_mib: '150',
  size_limit_mib: '0',
  trivy_severity: 'CRITICAL,HIGH',
  trivy_ignore_unfixed: 'false',
  trivy_fail_on_findings: 'false',
  trivy_ignore_file: '',
  upload_sarif: 'true',
  sarif_category: '',
  comment: 'per-image',
  comment_identifier: '',
};

let root: string;
// One file for the whole suite: `core.summary` resolves GITHUB_STEP_SUMMARY once and caches it.
let summaryDirectory: string;
let summaryFile: string;

beforeAll(async () => {
  summaryDirectory = await mkdtemp(path.join(tmpdir(), 'image-check-summary-'));
  summaryFile = path.join(summaryDirectory, 'summary.md');
});

afterAll(async () => {
  await rm(summaryDirectory, { recursive: true, force: true });
});

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'image-check-action-'));
  await mkdir(path.join(root, 'temp'));
  await mkdir(path.join(root, 'workspace'));
  await writeFile(summaryFile, '');
  vi.stubEnv('GITHUB_STEP_SUMMARY', summaryFile);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});

function setInputs(inputs: Record<string, string>): void {
  for (const [name, value] of Object.entries(inputs)) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls.map(([name, value]) => [name, String(value)]));
}

interface Scene {
  sizeBytes?: number;
  /** Event payload; `undefined` runs outside any event, as a push would for this action's purposes. */
  event?: unknown;
  inspect?: Partial<CommandResult>;
}

async function dependencies(scene: Scene = {}): Promise<ActionDependencies & { commands: string[][] }> {
  const commands: string[][] = [];
  let eventPath = '';

  if (scene.event !== undefined) {
    eventPath = path.join(root, 'event.json');
    await writeFile(eventPath, JSON.stringify(scene.event));
  }

  return {
    commands,
    runCommand: (command, args) => {
      commands.push([command, ...args]);

      return Promise.resolve({
        exitCode: 0,
        stdout: `${scene.sizeBytes ?? 87 * BYTES_PER_MIB}\n`,
        stderr: '',
        ...scene.inspect,
      });
    },
    context: {
      runnerTemp: path.join(root, 'temp'),
      workspace: path.join(root, 'workspace'),
      repository: REPOSITORY,
      serverUrl: 'https://github.com',
      eventPath,
    },
  };
}

function pullRequestEvent(headRepository = REPOSITORY) {
  return { pull_request: { number: 7, head: { repo: { full_name: headRepository } } } };
}

/** Runs measure, writes what Trivy would have, runs report, and returns the outputs of both. */
async function measureAndReport(
  deps: ActionDependencies,
  inputs: Record<string, string> = {},
  sarif: unknown = { runs: [{ results: [{}, {}, {}] }] },
): Promise<Record<string, string>> {
  setInputs({ ...MEASURE_INPUTS, ...inputs, phase: 'measure' });
  await run(deps);
  expect(core.setFailed).not.toHaveBeenCalled();

  const measured = outputs();
  await writeFile(measured['sarif_path'], JSON.stringify(sarif));

  vi.mocked(core.setOutput).mockClear();
  setInputs({ phase: 'report', plan: measured['plan'] });
  await run(deps);
  expect(core.setFailed).not.toHaveBeenCalled();

  return { ...measured, ...outputs() };
}

async function enforce(deps: ActionDependencies, plan: string): Promise<void> {
  setInputs({ phase: 'enforce', plan });
  await run(deps);
}

describe('measure', () => {
  it('validates, measures and publishes the derived names', async () => {
    const deps = await dependencies({ event: pullRequestEvent() });
    setInputs({ ...MEASURE_INPUTS, phase: 'measure' });

    await run(deps);

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(deps.commands).toEqual([['docker', 'image', 'inspect', '--format', '{{.Size}}', '--', 'app:test']]);
    expect(outputs()).toMatchObject({
      image: 'app:test',
      size_bytes: String(87 * BYTES_PER_MIB),
      size_mib: '87.0',
      over_warning: 'false',
      severity: 'CRITICAL,HIGH',
      ignore_unfixed: 'false',
      ignore_file: '',
      sarif_category: 'trivy-linux-amd64',
      upload_sarif: 'true',
      comment_identifier: 'docker-image-size-linux-amd64',
      write_comment: 'true',
      upload_fragment: 'false',
      fragment_name: 'image-check-linux-amd64',
    });
  });

  it('keeps the SARIF under RUNNER_TEMP, never the workspace', async () => {
    const deps = await dependencies();
    setInputs({ ...MEASURE_INPUTS, phase: 'measure' });

    await run(deps);

    const sarifPath = outputs()['sarif_path'];
    expect(path.relative(deps.context.runnerTemp, sarifPath).startsWith('..')).toBe(false);
  });

  it('fails before the scan on an invalid input, and runs nothing', async () => {
    const deps = await dependencies();
    setInputs({ ...MEASURE_INPUTS, size_warning_mib: '150MB', phase: 'measure' });

    await run(deps);

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('size-warning-mib'));
    expect(deps.commands).toEqual([]);
  });

  it('fails at once, naming the reference, when the image was never loaded', async () => {
    const deps = await dependencies({ inspect: { exitCode: 1, stderr: 'Error: No such image: app:test' } });
    setInputs({ ...MEASURE_INPUTS, phase: 'measure' });

    await run(deps);

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("Image 'app:test' is not in the Docker daemon"),
    );
  });

  it('refuses an ignore file that does not exist', async () => {
    const deps = await dependencies();
    setInputs({ ...MEASURE_INPUTS, trivy_ignore_file: '.trivyignore', phase: 'measure' });

    await run(deps);

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('trivy-ignore-file'));
  });

  it('accepts an ignore file that exists in the workspace', async () => {
    const deps = await dependencies();
    await writeFile(path.join(deps.context.workspace, '.trivyignore'), 'CVE-2024-0001\n');
    setInputs({ ...MEASURE_INPUTS, trivy_ignore_file: '.trivyignore', phase: 'measure' });

    await run(deps);

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(outputs()['ignore_file']).toBe('.trivyignore');
  });

  it('refuses an ignore file outside the workspace', async () => {
    const deps = await dependencies();
    setInputs({ ...MEASURE_INPUTS, trivy_ignore_file: '../etc/passwd', phase: 'measure' });

    await run(deps);

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('trivy-ignore-file'));
  });

  it('publishes nothing to the pull request outside one, but still uploads the SARIF', async () => {
    const deps = await dependencies();
    setInputs({ ...MEASURE_INPUTS, phase: 'measure' });

    await run(deps);

    expect(outputs()).toMatchObject({ upload_sarif: 'true', write_comment: 'false', upload_fragment: 'false' });
  });

  it('skips the SARIF and the comment on a fork, with a notice', async () => {
    const deps = await dependencies({ event: pullRequestEvent('mallory/app') });
    setInputs({ ...MEASURE_INPUTS, phase: 'measure' });

    await run(deps);

    expect(outputs()).toMatchObject({ upload_sarif: 'false', write_comment: 'false', upload_fragment: 'false' });
    expect(core.notice).toHaveBeenCalledWith(expect.stringContaining('GITHUB_TOKEN is read-only'));
  });

  it('uploads a fragment instead of commenting in summary mode', async () => {
    const deps = await dependencies({ event: pullRequestEvent() });
    setInputs({ ...MEASURE_INPUTS, comment: 'summary', phase: 'measure' });

    await run(deps);

    expect(outputs()).toMatchObject({ write_comment: 'false', upload_fragment: 'true' });
  });

  it('publishes nothing to the pull request with comment none', async () => {
    const deps = await dependencies({ event: pullRequestEvent() });
    setInputs({ ...MEASURE_INPUTS, comment: 'none', phase: 'measure' });

    await run(deps);

    expect(outputs()).toMatchObject({ write_comment: 'false', upload_fragment: 'false' });
  });
});

describe('report', () => {
  it('counts the findings and renders the comment with a code scanning link', async () => {
    const deps = await dependencies({ event: pullRequestEvent() });

    const result = await measureAndReport(deps);

    expect(result['findings']).toBe('3');
    expect(result['comment_body']).toBe(
      '**Docker image** `linux/amd64`: 87.0 MiB (uncompressed), warning above 150 MiB.\n' +
        'Trivy: 3 findings at CRITICAL,HIGH. [Code scanning](https://github.com/acme/app/security/code-scanning?query=pr%3A7)',
    );
  });

  it('omits the link when the SARIF is not uploaded', async () => {
    const deps = await dependencies({ event: pullRequestEvent() });

    const result = await measureAndReport(deps, { upload_sarif: 'false' });

    expect(result['comment_body']).not.toContain('Code scanning');
  });

  it('writes the step summary on every event, a fork included', async () => {
    const deps = await dependencies({ event: pullRequestEvent('mallory/app') });

    await measureAndReport(deps);

    expect(await readFile(summaryFile, 'utf8')).toContain('| `app:test` | `linux/amd64` | 87.0 | 3 at CRITICAL,HIGH |');
  });

  it('writes the fragment in summary mode', async () => {
    const deps = await dependencies({ event: pullRequestEvent() });

    const result = await measureAndReport(deps, { comment: 'summary' });

    expect(JSON.parse(await readFile(result['fragment_path'], 'utf8'))).toEqual({
      version: 1,
      platform: 'linux/amd64',
      image: 'app:test',
      size_bytes: 87 * BYTES_PER_MIB,
      warning_mib: 150,
      findings: 3,
      severity: 'CRITICAL,HIGH',
    });
    expect(result['comment_body']).toBeUndefined();
  });

  it('fails on a SARIF file that is not a SARIF log, rather than reading it as clean', async () => {
    const deps = await dependencies();
    setInputs({ ...MEASURE_INPUTS, phase: 'measure' });
    await run(deps);
    const measured = outputs();
    await writeFile(measured['sarif_path'], '{}');

    setInputs({ phase: 'report', plan: measured['plan'] });
    await run(deps);

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("no 'runs' array"));
  });
});

describe('enforce', () => {
  it('passes an image under every threshold', async () => {
    const deps = await dependencies();
    const result = await measureAndReport(deps);

    await enforce(deps, result['plan']);

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.warning).not.toHaveBeenCalled();
  });

  it('warns, without failing, above the warning threshold', async () => {
    const deps = await dependencies({ sizeBytes: 162 * BYTES_PER_MIB });
    const result = await measureAndReport(deps);

    await enforce(deps, result['plan']);

    expect(result['over_warning']).toBe('true');
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('above the 150 MiB warning threshold'), {
      title: 'Docker image size',
    });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('fails above the limit and on findings, naming both', async () => {
    const deps = await dependencies({ sizeBytes: 400 * BYTES_PER_MIB });
    const result = await measureAndReport(deps, { size_limit_mib: '300', trivy_fail_on_findings: 'true' });

    await enforce(deps, result['plan']);

    const message = String(vi.mocked(core.setFailed).mock.calls[0]?.[0]);
    expect(message).toContain('above the 300 MiB limit');
    expect(message).toContain('Trivy reported 3 finding(s) at CRITICAL,HIGH');
  });

  it('stays advisory on findings by default', async () => {
    const deps = await dependencies();
    const result = await measureAndReport(deps);

    await enforce(deps, result['plan']);

    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('refuses to enforce before the report phase counted the findings', async () => {
    const deps = await dependencies();
    setInputs({ ...MEASURE_INPUTS, phase: 'measure' });
    await run(deps);

    await enforce(deps, outputs()['plan']);

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('report phase must run before enforce'));
  });
});

it('refuses an unknown phase', async () => {
  setInputs({ phase: 'scan' });

  await run(await dependencies());

  expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('is not a phase'));
});
