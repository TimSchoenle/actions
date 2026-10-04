import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PlanError } from './errors.js';
import { createPlanLocation, parsePlan, readPlan, writePlan } from './plan.js';

import type { Plan } from './plan.js';

const PLAN: Plan = {
  version: 1,
  image: 'app:test',
  platform: 'linux/amd64',
  sizeBytes: 1,
  warningMib: 150,
  limitMib: 0,
  severity: 'CRITICAL,HIGH',
  failOnFindings: false,
  sarifPath: '/tmp/x.sarif',
  uploadSarif: true,
  writeComment: true,
  uploadFragment: false,
  fragmentPath: '/tmp/fragment.json',
  codeScanningUrl: '',
  findings: null,
};

let runnerTemp: string;

beforeEach(async () => {
  runnerTemp = await mkdtemp(path.join(tmpdir(), 'image-check-plan-'));
});

afterEach(async () => {
  await rm(runnerTemp, { recursive: true, force: true });
});

describe('createPlanLocation', () => {
  it('gives two checks in one job two directories', async () => {
    const first = await createPlanLocation(runnerTemp, 'linux-amd64');
    const second = await createPlanLocation(runnerTemp, 'linux-amd64');

    expect(path.dirname(first.planPath)).not.toBe(path.dirname(second.planPath));
    expect(path.basename(first.sarifPath)).toBe('trivy-linux-amd64.sarif');
  });

  it('names the SARIF after the image when there is no platform', async () => {
    expect(path.basename((await createPlanLocation(runnerTemp, '')).sarifPath)).toBe('trivy-image.sarif');
  });

  it('keeps every file under RUNNER_TEMP', async () => {
    const location = await createPlanLocation(runnerTemp, 'x');

    for (const file of Object.values(location)) {
      expect(path.relative(runnerTemp, file).startsWith('..')).toBe(false);
    }
  });
});

describe('readPlan', () => {
  it('reads back what was written', async () => {
    const { planPath } = await createPlanLocation(runnerTemp, 'x');
    await writePlan(planPath, { ...PLAN, findings: 4 });

    await expect(readPlan(planPath, runnerTemp)).resolves.toEqual({ ...PLAN, findings: 4 });
  });

  it('refuses a plan outside RUNNER_TEMP', async () => {
    const elsewhere = await mkdtemp(path.join(tmpdir(), 'image-check-elsewhere-'));

    try {
      const planPath = path.join(elsewhere, 'plan.json');
      await writePlan(planPath, PLAN);

      await expect(readPlan(planPath, runnerTemp)).rejects.toThrow('not under RUNNER_TEMP');
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it('refuses an empty path, which means the measure phase never ran', async () => {
    await expect(readPlan('', runnerTemp)).rejects.toThrow('measure phase must run first');
  });

  it('refuses a missing file', async () => {
    await expect(readPlan(path.join(runnerTemp, 'none.json'), runnerTemp)).rejects.toThrow(PlanError);
  });

  it('refuses a file that is not JSON', async () => {
    const planPath = path.join(runnerTemp, 'plan.json');
    await writeFile(planPath, 'not json');

    await expect(readPlan(planPath, runnerTemp)).rejects.toThrow('not valid JSON');
  });
});

describe('parsePlan', () => {
  it.each([
    ['another version', { ...PLAN, version: 2 }],
    ['a field of the wrong type', { ...PLAN, sizeBytes: '1' }],
    ['a missing field', { ...PLAN, sarifPath: undefined }],
    ['a negative findings count', { ...PLAN, findings: -1 }],
    ['an array', []],
  ])('refuses %s', (_case, value) => {
    expect(() => parsePlan(value)).toThrow(PlanError);
  });
});
