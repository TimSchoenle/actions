import path from 'node:path';

import { runGit, validateArtifactName } from 'actions-util/patch';
import { readPatchArtifact } from 'actions-util/patch-reader';

import type { PatchArtifact } from 'actions-util/patch-reader';

/** Results GitHub reports for a job in the `needs` context. */
const JOB_RESULTS = ['success', 'failure', 'cancelled', 'skipped'] as const;

type JobResult = (typeof JOB_RESULTS)[number];

/** A job of the `needs` context, reduced to what the verdict reads. */
export interface NeededJob {
  readonly id: string;
  readonly result: JobResult;
  readonly outputs: Readonly<Record<string, string>>;
}

/** What the verdict concludes from the `needs` context alone. */
export interface Evaluation {
  /** Jobs that failed or were cancelled, in the order `needs` lists them. */
  readonly failedJobs: readonly string[];
  /** Jobs whose patch is non-empty, in the order `needs` lists them. */
  readonly pendingJobs: readonly string[];
  /** The pending jobs' artifact names, in the same order. */
  readonly artifacts: readonly string[];
}

/** Raised when the `needs` input does not have the shape `toJSON(needs)` produces. */
export class NeedsInputError extends Error {
  constructor(message: string) {
    super(`needs is not toJSON(needs): ${message}`);
    this.name = 'NeedsInputError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses `toJSON(needs)`.
 *
 * Strict on purpose: the verdict is a required check, and a typo in the caller that left it reading
 * nothing would pass every pull request. An empty object is refused for the same reason.
 */
export function parseNeeds(text: string): NeededJob[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new NeedsInputError(`it is not JSON (${(error as Error).message}).`);
  }
  if (!isRecord(parsed)) {
    throw new NeedsInputError('expected an object keyed by job id.');
  }

  const jobs = Object.entries(parsed).map(([id, job]): NeededJob => {
    if (!isRecord(job)) {
      throw new NeedsInputError(`job ${id} is not an object.`);
    }
    const { result, outputs = {} } = job;
    if (typeof result !== 'string' || !(JOB_RESULTS as readonly string[]).includes(result)) {
      throw new NeedsInputError(`job ${id} has result ${JSON.stringify(result)}.`);
    }
    if (!isRecord(outputs) || Object.values(outputs).some((value) => typeof value !== 'string')) {
      throw new NeedsInputError(`job ${id} has outputs that are not all strings.`);
    }
    return { id, outputs: outputs as Record<string, string>, result: result as JobResult };
  });

  if (jobs.length === 0) {
    throw new NeedsInputError('it lists no jobs; give the verdict job a needs: list of the generator jobs.');
  }
  return jobs;
}

/**
 * Sorts the jobs into failed, pending and fine.
 *
 * A job is pending when its `changesOutput` is exactly `true`, the value create-patch reports. A
 * pending job must also name its artifact, or there would be nothing to merge and the pull request
 * could never be fixed by the commit job; that is a caller error and fails here. So is a job whose
 * artifact has the merged patch's name. A skipped job is fine: its paths did not change.
 */
export function evaluateNeeds(
  jobs: readonly NeededJob[],
  changesOutput: string,
  artifactOutput: string,
  mergedArtifact: string,
): Evaluation {
  const failedJobs: string[] = [];
  const pendingJobs: string[] = [];
  const artifacts: string[] = [];

  for (const job of jobs) {
    // Were a verdict to stop before its own upload, the commit job would take this job's patch for
    // the merged one.
    if (job.outputs[artifactOutput] === mergedArtifact) {
      throw new NeedsInputError(
        `job ${job.id} uploaded an artifact named ${mergedArtifact}, the name of the merged patch; rename one of them.`,
      );
    }
    if (job.result === 'failure' || job.result === 'cancelled') {
      failedJobs.push(job.id);
      continue;
    }
    if (job.outputs[changesOutput] !== 'true') {
      continue;
    }

    const artifact = job.outputs[artifactOutput] ?? '';
    if (artifact === '') {
      throw new NeedsInputError(
        `job ${job.id} reports changes but sets no ${artifactOutput} output; expose create-patch's artifact_name as one.`,
      );
    }
    pendingJobs.push(job.id);
    artifacts.push(validateArtifactName(artifact));
  }

  const duplicate = artifacts.find((name, index) => artifacts.indexOf(name) !== index);
  if (duplicate !== undefined) {
    throw new NeedsInputError(`two jobs uploaded an artifact named ${duplicate}; give each generator its own name.`);
  }

  return { artifacts, failedJobs, pendingJobs };
}

/**
 * Where download-artifact has to put the artifacts so each lands in `directory/<name>`.
 *
 * download-artifact extracts into a subdirectory per artifact only when its pattern matches several;
 * a pattern matching exactly one is extracted straight into `path`. So for one artifact the path is
 * its own subdirectory, and the layout {@link inspectPatches} reads is the same either way.
 */
export function downloadPath(directory: string, artifacts: readonly string[]): string {
  if (directory === '' || artifacts.length === 0) {
    return '';
  }
  return artifacts.length === 1 ? path.join(directory, artifacts[0] ?? '') : directory;
}

/**
 * The download-artifact `pattern` that matches exactly `artifacts`.
 *
 * Artifact names are limited to letters, digits, `.`, `_` and `-`, none of which minimatch treats as
 * special, so a name is its own pattern and several are joined as a brace set. download-artifact puts
 * each artifact a pattern matches in a directory of its own name, which {@link inspectPatches} reads.
 */
export function downloadPattern(artifacts: readonly string[]): string {
  if (artifacts.length === 0) {
    return '';
  }
  return artifacts.length === 1 ? (artifacts[0] ?? '') : `{${artifacts.join(',')}}`;
}

/** Raised when the pending patches were not all made from the same commit. */
export class MixedBaseError extends Error {
  constructor(bases: ReadonlyMap<string, string>) {
    const listing = [...bases].map(([artifact, base]) => `${artifact} from ${base}`).join(', ');
    super(
      `The generator patches were made from different commits (${listing}). Check out the same commit ` +
        'in every generator job, normally github.event.pull_request.head.sha.',
    );
    this.name = 'MixedBaseError';
  }
}

/**
 * Validates every downloaded patch and returns them with the one commit they share.
 *
 * Each directory is read with the same strict reader commit-patch uses. The patches can only be
 * merged when they share a base: applied on top of each other they must describe one tree, and the
 * merged patch has a single base_sha that the commit job checks against the pull request head.
 */
export async function inspectPatches(
  directory: string,
  artifacts: readonly string[],
  maxPatchBytes: number,
): Promise<{ baseSha: string; patches: PatchArtifact[] }> {
  if (artifacts.length === 0) {
    throw new Error('artifacts is empty; inspect runs only when a job reported changes.');
  }

  const patches: PatchArtifact[] = [];
  const bases = new Map<string, string>();
  for (const artifact of artifacts) {
    const patch = await readPatchArtifact(path.join(directory, validateArtifactName(artifact)), maxPatchBytes);
    patches.push(patch);
    bases.set(artifact, patch.metadata.baseSha);
  }

  const distinct = new Set(bases.values());
  if (distinct.size !== 1) {
    throw new MixedBaseError(bases);
  }
  const [baseSha] = distinct;
  return { baseSha: baseSha ?? '', patches };
}

/** Raised when a generator's patch does not apply on top of the ones before it. */
export class PatchConflictError extends Error {
  constructor(artifact: string, detail: string) {
    super(
      `The ${artifact} patch does not apply on top of the patches before it, so two generators changed ` +
        `the same lines; make their paths disjoint. git apply said: ${detail}`,
    );
    this.name = 'PatchConflictError';
  }
}

/**
 * Applies each patch to the working tree, in order.
 *
 * `git apply` refuses a hunk that does not match rather than guessing, so two generators that rewrote
 * the same lines fail the verdict instead of one silently winning. An empty patch is skipped: git
 * apply rejects input with no diff in it.
 */
export async function applyPatches(
  workspace: string,
  artifacts: readonly string[],
  patches: readonly PatchArtifact[],
): Promise<void> {
  for (const [index, patch] of patches.entries()) {
    if (!patch.metadata.hasChanges) {
      continue;
    }
    const artifact = artifacts[index] ?? `#${index}`;
    try {
      await runGit(['apply', '--binary', '--whitespace=nowarn', '--', patch.patchPath], { cwd: workspace });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new PatchConflictError(artifact, detail);
    }
  }
}
