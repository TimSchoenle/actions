import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { ROOT_DIR } from '../lib/utils.js';

/**
 * The input parsing of `actions/helm/update-chart-version`, the composite's only shell step, run as
 * the runner runs it: `bash -e` with the inputs in the environment and a `GITHUB_OUTPUT` file. The test
 * lives here rather than beside the action, so a change to it does not release the action.
 */

const MANIFEST = path.join(ROOT_DIR, 'actions/helm/update-chart-version/action.yaml');

function parseStepScript(): string {
  const manifest = parse(fs.readFileSync(MANIFEST, 'utf8')) as { runs: { steps: { id?: string; run?: string }[] } };
  const step = manifest.runs.steps.find((candidate) => candidate.id === 'parse');
  if (step?.run === undefined) {
    throw new Error('update-chart-version has no parse step');
  }

  return step.run;
}

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** Runs the parse step; returns its exit status, stderr and the outputs it wrote. */
function runParse(chartPath: string): { status: number | null; stdout: string; outputs: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'update-chart-version-'));
  directories.push(directory);
  const output = path.join(directory, 'output');
  fs.writeFileSync(output, '');
  const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', parseStepScript()], {
    encoding: 'utf8',
    env: {
      PATH: process.env['PATH'],
      CHART_PATH: chartPath,
      HELM_REPO: 'owner/charts',
      PULL_CONTRACTS: 'false',
      GITHUB_OUTPUT: output,
    },
  });

  return { status: result.status, stdout: result.stdout, outputs: fs.readFileSync(output, 'utf8') };
}

describe('update-chart-version input parsing', () => {
  it('writes the chart name, owner and repo for a plain chart path', () => {
    const { status, outputs } = runParse('charts/my-app');

    expect(status).toBe(0);
    expect(outputs.split('\n').filter(Boolean).sort()).toEqual(['chart-name=my-app', 'owner=owner', 'repo=charts']);
  });

  // S16c: the basename of a multi-line chart-path went to GITHUB_OUTPUT as written, so its second
  // line set owner and repo, which choose where the App token is minted.
  it.each([
    ['a second line', 'charts/app\nowner=attacker'],
    ['a carriage return', 'charts/app\rowner=attacker'],
    ['a space', 'charts/my app'],
    ['a shell metacharacter', 'charts/$(id)'],
    ['nothing', ''],
  ])('refuses a chart path with %s, before writing any output', (_name, chartPath) => {
    const { status, stdout, outputs } = runParse(chartPath);

    expect(status).toBe(1);
    expect(stdout).toContain('::error::chart-path');
    expect(outputs).toBe('');
  });
});

describe('update-chart-version checkout', () => {
  // P14k: the charts repository was cloned with its whole history, which nothing after the checkout
  // reads: apply-chart-updates edits files, terrace-contract pull fetches from a registry, and
  // commit-changes reads only the working tree status and HEAD.
  it('checks the charts repository out without its history', () => {
    const manifest = parse(fs.readFileSync(MANIFEST, 'utf8')) as {
      runs: { steps: { name?: string; with?: Record<string, unknown> }[] };
    };
    const checkout = manifest.runs.steps.find((step) => step.name === 'Checkout Helm Charts');

    expect(checkout?.with).toBeDefined();
    expect(checkout?.with).not.toHaveProperty('fetch-depth');
  });
});
