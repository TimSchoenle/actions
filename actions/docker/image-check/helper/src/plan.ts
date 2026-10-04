/**
 * The plan the measure phase hands the report and enforce phases.
 *
 * The composite runs this helper three times, with Trivy, upload-sarif and upsert-pr-comment in
 * between. Passing every validated value forward as a file, rather than re-reading the composite's
 * inputs each time, means the inputs are validated exactly once and the later phases cannot see a
 * different value than the one that was measured and scanned.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PlanError } from './errors.js';

const PLAN_VERSION = 1;

/** Everything the later phases need, flat so its shape can be checked field by field. */
export interface Plan {
  readonly version: typeof PLAN_VERSION;
  readonly image: string;
  readonly platform: string;
  readonly sizeBytes: number;
  readonly warningMib: number;
  readonly limitMib: number;
  readonly severity: string;
  readonly failOnFindings: boolean;
  readonly sarifPath: string;
  /** Whether the SARIF upload step runs, after the fork check. */
  readonly uploadSarif: boolean;
  /** Whether the per-image comment step runs, after the event and fork checks. */
  readonly writeComment: boolean;
  /** Whether the summary fragment is uploaded, after the event and fork checks. */
  readonly uploadFragment: boolean;
  readonly fragmentPath: string;
  /** Empty when there is no uploaded SARIF to link to. */
  readonly codeScanningUrl: string;
  /** `null` until the report phase has counted the SARIF. */
  readonly findings: number | null;
}

/** The type each plan field must have, which is the whole of the validation a read performs. */
const FIELD_TYPES: Readonly<Record<Exclude<keyof Plan, 'findings' | 'version'>, 'boolean' | 'number' | 'string'>> = {
  image: 'string',
  platform: 'string',
  sizeBytes: 'number',
  warningMib: 'number',
  limitMib: 'number',
  severity: 'string',
  failOnFindings: 'boolean',
  sarifPath: 'string',
  uploadSarif: 'boolean',
  writeComment: 'boolean',
  uploadFragment: 'boolean',
  fragmentPath: 'string',
  codeScanningUrl: 'string',
};

const PLAN_FILE = 'plan.json';

/** The files one check writes, all inside one directory of its own under `RUNNER_TEMP`. */
export interface PlanLocation {
  readonly planPath: string;
  readonly sarifPath: string;
  readonly fragmentPath: string;
}

/**
 * Creates a fresh directory for one check under `RUNNER_TEMP`.
 *
 * Under `RUNNER_TEMP` and never the workspace, so a later `git add` or `commit-changes` cannot pick
 * up the SARIF. Unique per call, so two checks in one job — two platforms built side by side —
 * never write over each other's files.
 */
export async function createPlanLocation(runnerTemp: string, slug: string): Promise<PlanLocation> {
  const directory = await mkdtemp(path.join(runnerTemp, 'image-check-'));
  const fragmentDirectory = path.join(directory, 'fragment');

  await mkdir(fragmentDirectory);

  return {
    planPath: path.join(directory, PLAN_FILE),
    sarifPath: path.join(directory, `trivy-${slug === '' ? 'image' : slug}.sarif`),
    fragmentPath: path.join(fragmentDirectory, 'fragment.json'),
  };
}

export async function writePlan(planPath: string, plan: Plan): Promise<void> {
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
}

/** Checks a parsed value against {@link FIELD_TYPES}. */
export function parsePlan(value: unknown): Plan {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PlanError('The plan file does not hold a JSON object.');
  }

  const record = value as Record<string, unknown>;

  if (record['version'] !== PLAN_VERSION) {
    throw new PlanError(`The plan file is version ${String(record['version'])}, expected ${PLAN_VERSION}.`);
  }

  for (const [field, type] of Object.entries(FIELD_TYPES)) {
    if (typeof record[field] !== type) {
      throw new PlanError(`The plan file's '${field}' is not a ${type}.`);
    }
  }

  const findings = record['findings'];

  if (findings !== null && (typeof findings !== 'number' || !Number.isSafeInteger(findings) || findings < 0)) {
    throw new PlanError("The plan file's 'findings' is neither null nor a count.");
  }

  return record as unknown as Plan;
}

/**
 * Reads the plan the measure phase wrote.
 *
 * Refuses a path outside `RUNNER_TEMP`: the input is only ever the measure phase's own output, and
 * nothing else has a reason to point it anywhere else.
 */
export async function readPlan(planPath: string, runnerTemp: string): Promise<Plan> {
  if (planPath === '') {
    throw new PlanError('No plan file was given. The measure phase must run first.');
  }

  const root = path.resolve(runnerTemp);
  const resolved = path.resolve(planPath);
  const fromRoot = path.relative(root, resolved);

  if (fromRoot === '' || fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
    throw new PlanError('The plan file is not under RUNNER_TEMP.');
  }

  let text: string;

  try {
    text = await readFile(resolved, 'utf8');
  } catch (error) {
    throw new PlanError('The plan file could not be read. The measure phase must run first.', error);
  }

  try {
    return parsePlan(JSON.parse(text));
  } catch (error) {
    if (error instanceof PlanError) {
      throw error;
    }

    throw new PlanError('The plan file is not valid JSON.', error);
  }
}
