import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real, so the tests
 * exercise the `INPUT_*` semantics the runner actually uses rather than a stand-in for them.
 */
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

const CHART_PATH = 'charts/app';
const CHART = 'apiVersion: v2\nname: app\nversion: 1.2.3\nappVersion: "v0.4.1"\n';
const VALUES = `services:
  api:
    image:
      tag: v0.4.1@sha256:aaa
  worker:
    image:
      tag: v0.4.1@sha256:bbb
`;

const IMAGES = JSON.stringify({
  'services.api.image.tag': { tag: 'v1.0.0', digest: `sha256:${'1'.repeat(64)}` },
  'services.worker.image.tag': { tag: 'v0.9.4', digest: `sha256:${'2'.repeat(64)}` },
});

function defaultInputs(): Record<string, string> {
  return {
    'chart-path': CHART_PATH,
    images: IMAGES,
    'value-template': '${tag}@${digest}',
    variables: '{}',
    'app-version': '',
    'version-bump': 'patch',
    'chart-version': '',
    changelog: '',
    'changelog-max-bytes': '30000',
    // `[.]` rather than an escaped dot: identical to the manifest default, without a backslash to
    // mis-count through JSON and YAML on the way to the runner.
    'key-pattern': '^([A-Za-z0-9_-]+[.])*image[.]tag$',
    'value-pattern': '^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}(@sha256:[0-9a-f]{64})?$',
  };
}

function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls as [string, string][]);
}

describe('apply-chart-updates action', () => {
  let workspace: string;

  function setInputs(overrides: Record<string, string> = {}): void {
    for (const [name, value] of Object.entries({ ...defaultInputs(), ...overrides })) {
      vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    workspace = await mkdtemp(join(tmpdir(), 'apply-chart-action-'));
    await mkdir(join(workspace, CHART_PATH), { recursive: true });
    await writeFile(join(workspace, CHART_PATH, 'Chart.yaml'), CHART, 'utf8');
    await writeFile(join(workspace, CHART_PATH, 'values.yaml'), VALUES, 'utf8');
    vi.stubEnv('GITHUB_WORKSPACE', workspace);
    setInputs();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(workspace, { recursive: true, force: true });
  });

  it('updates every image and publishes what changed', async () => {
    await run();

    expect(core.setFailed).not.toHaveBeenCalled();

    const published = outputs();
    expect(published['chart-version']).toBe('1.2.4');
    expect(published['previous-chart-version']).toBe('1.2.3');
    expect(published['updated-count']).toBe('2');
    expect(published.files).toBe(`${CHART_PATH}/Chart.yaml ${CHART_PATH}/values.yaml`);
    expect(JSON.parse(published.changes)).toHaveLength(2);
    expect(published['summary-markdown']).toContain('services.worker.image.tag');
  });

  it('writes the per-image versions to values.yaml', async () => {
    await run();

    const values = await readFile(join(workspace, CHART_PATH, 'values.yaml'), 'utf8');
    expect(values).toContain(`tag: v1.0.0@sha256:${'1'.repeat(64)}`);
    expect(values).toContain(`tag: v0.9.4@sha256:${'2'.repeat(64)}`);
  });

  it('leaves appVersion alone unless one was supplied', async () => {
    await run();

    expect(await readFile(join(workspace, CHART_PATH, 'Chart.yaml'), 'utf8')).toContain('appVersion: "v0.4.1"');
  });

  it('honours an explicit chart-version over version-bump', async () => {
    setInputs({ 'chart-version': '9.9.9' });

    await run();

    expect(outputs()['chart-version']).toBe('9.9.9');
  });

  it('sanitizes the changelog before publishing it', async () => {
    setInputs({ changelog: 'Fixes #12, thanks @octocat' });

    await run();

    expect(outputs()['changelog-markdown']).toContain('&#70;ixes #12, thanks &#64;octocat');
    expect(outputs()['changelog-markdown']).toContain('<summary>Changelog</summary>');
  });

  it('publishes an empty changelog when none was given', async () => {
    await run();

    expect(outputs()['changelog-markdown']).toBe('');
  });

  it.each(['chart-path', 'images'])('fails when the required input %s is empty', async (name) => {
    setInputs({ [name]: '' });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining(name));
  });

  it('fails without writing anything when a key is not in the chart', async () => {
    setInputs({
      images: JSON.stringify({ 'services.absent.image.tag': { tag: 'v1', digest: `sha256:${'3'.repeat(64)}` } }),
    });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('services.absent.image.tag'));
    expect(await readFile(join(workspace, CHART_PATH, 'values.yaml'), 'utf8')).toBe(VALUES);
    expect(await readFile(join(workspace, CHART_PATH, 'Chart.yaml'), 'utf8')).toBe(CHART);
  });

  it('fails on a chart-path that leaves the workspace', async () => {
    setInputs({ 'chart-path': '../elsewhere' });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('chart-path'));
  });
});
