import { parseRepository, quoteForLog } from 'actions-util';

import { readPatchArtifact } from './artifact.js';
import { findViolations } from './path-policy.js';

import type { PatchGit } from './git.js';
import type { PatchPolicy, PolicyViolation } from './path-policy.js';
import type { RawChange } from './raw-diff.js';
import type { CommitApi, FileChanges } from 'actions-util/commit-on-branch';

/** The collaborators {@link commitPatch} drives, each faked independently in tests. */
export interface CommitPatchDeps {
  git: PatchGit;
  api: CommitApi;
  /** Reports a skip the workflow author should see without the step failing. */
  notice(message: string): void;
  info(message: string): void;
}

/** Everything read from the inputs that the commit needs. */
export interface CommitPatchRequest {
  /** Directory download-artifact extracted the artifact into. */
  directory: string;
  /** `owner/repo` to commit to. */
  repository: string;
  /** Branch to commit to. */
  branch: string;
  /** The commit message. */
  message: string;
  /**
   * The commit the branch is expected to point at, from the trusted event payload. The artifact's
   * base must equal it, the checkout must be at it, and it is the `expectedHeadOid` of the commit.
   */
  expectedHeadSha: string;
  policy: PatchPolicy;
  maxPatchBytes: number;
}

/** How the run ended. */
export type CommitPatchOutcome = 'committed' | 'no_changes' | 'branch_moved';

/** What the run did. */
export interface CommitPatchResult {
  outcome: CommitPatchOutcome;
  /** SHA of the created commit, when one was created. */
  commitSha?: string;
  /** URL of the created commit, when one was created. */
  commitUrl?: string;
}

/** Raised when the patch touches something the policy does not allow; lists every violation. */
export class PatchPolicyError extends Error {
  readonly violations: readonly PolicyViolation[];

  constructor(violations: readonly PolicyViolation[]) {
    const lines = violations.map((violation) => `  ${quoteForLog(violation.path)}: ${violation.reason}`);
    super(`The patch was refused; nothing was committed.\n${lines.join('\n')}`);
    this.name = 'PatchPolicyError';
    this.violations = violations;
  }
}

/**
 * The prefix git's binary-detection heuristic inspects: content with a NUL byte in its first 8000
 * bytes is binary to git, and so it is here.
 */
const BINARY_PROBE_BYTES = 8000;

function looksBinary(contents: Buffer): boolean {
  return contents.subarray(0, BINARY_PROBE_BYTES).includes(0);
}

/**
 * Reads the new content of every added or modified path and splits the changes into the shape
 * `createCommitOnBranch` takes, collecting the paths whose new content is binary on the way.
 */
async function buildFileChanges(
  git: PatchGit,
  changes: readonly RawChange[],
): Promise<{ fileChanges: FileChanges; binary: Set<string> }> {
  const fileChanges: FileChanges = { additions: [], deletions: [] };
  const binary = new Set<string>();

  for (const change of changes) {
    if (change.status === 'D') {
      fileChanges.deletions.push({ path: change.path });
      continue;
    }

    const contents = await git.readBlob(change.dstSha);
    if (looksBinary(contents)) {
      binary.add(change.path);
    }
    fileChanges.additions.push({ contents: contents.toString('base64'), path: change.path });
  }

  return { binary, fileChanges };
}

/**
 * Validates the artifact `create-patch` uploaded and commits it to the branch as a verified commit.
 *
 * The order is what makes it safe to run beside a write token:
 *
 * 1. The artifact is checked for shape, size and digest before any of it reaches git.
 * 2. Its base must be the head the trusted event names. Anything else is a stale artifact from a run
 *    the branch has since moved past, and is skipped with a notice rather than committed on top of
 *    work it never saw.
 * 3. The patch is applied to a throwaway index on top of that base. git's own view of the result —
 *    not a parse of the patch text — is what the policy then judges, so a patch crafted to read one
 *    way and apply another gains nothing.
 * 4. Every changed path must pass the policy; any violation fails the step and nothing is written.
 * 5. The branch head is read once more, and the commit is created with `expectedHeadOid` set to the
 *    base, so GitHub itself refuses the write if the branch moved in between.
 *
 * File contents are read from git's object store by blob SHA, never from the working tree, so no
 * symbolic link in the checkout can redirect what is committed.
 *
 * @throws {PatchPolicyError} when any change violates the policy.
 */
export async function commitPatch(deps: CommitPatchDeps, request: CommitPatchRequest): Promise<CommitPatchResult> {
  const { expectedHeadSha, policy } = request;
  if (request.branch === '') {
    throw new Error('No branch given. A branch to commit to is required.');
  }
  const coordinates = parseRepository(request.repository);

  const { metadata, patchPath } = await readPatchArtifact(request.directory, request.maxPatchBytes);

  if (metadata.baseSha !== expectedHeadSha) {
    deps.notice(
      `The patch was computed against ${metadata.baseSha}, but the expected head is ${expectedHeadSha}. ` +
        'The branch moved after the patch was made; skipping, and the run for the new head will redo it.',
    );
    return { outcome: 'branch_moved' };
  }

  if (!metadata.hasChanges) {
    deps.info('The patch is empty; nothing to commit.');
    return { outcome: 'no_changes' };
  }

  const checkoutHead = await deps.git.headSha();
  if (checkoutHead !== expectedHeadSha) {
    throw new Error(
      `The checkout is at ${checkoutHead}, not at the expected head ${expectedHeadSha}. Check out ` +
        'expected_head_sha before this step, so the patch is applied to the commit it was made from.',
    );
  }

  const binaryHunks = await deps.git.binaryPathsInPatch(patchPath);
  const changes = await deps.git.applyToScratchIndex(expectedHeadSha, patchPath);

  if (changes.length === 0) {
    deps.info('The patch applies, but changes nothing against the base; nothing to commit.');
    return { outcome: 'no_changes' };
  }

  const links = await deps.git.linksInTree(expectedHeadSha);

  // Judge paths and modes before reading any content: a refused change is never read, so a
  // submodule's commit ID is never handed to `cat-file blob` and nothing refused is held in memory.
  // Only the changes that pass are read, which is what finds binary content the patch presented as
  // text, and every violation of both passes is reported together.
  const refused = new Set(findViolations(changes, policy, links, binaryHunks).map(({ path }) => path));
  const readable = changes.filter((change) => !refused.has(change.path));
  const { binary: binaryContent, fileChanges } = await buildFileChanges(deps.git, readable);

  const violations = findViolations(changes, policy, links, new Set([...binaryHunks, ...binaryContent]));
  if (violations.length > 0) {
    throw new PatchPolicyError(violations);
  }

  const currentHead = await deps.api.getHeadOid(coordinates, request.branch);
  if (currentHead !== expectedHeadSha) {
    deps.notice(
      `Branch '${request.branch}' is at ${currentHead}, no longer at ${expectedHeadSha}. Skipping; the run for ` +
        'the new head will redo it.',
    );
    return { outcome: 'branch_moved' };
  }

  deps.info(`Committing ${fileChanges.additions.length} addition(s) and ${fileChanges.deletions.length} deletion(s).`);

  const commit = await deps.api.createCommit({
    branch: request.branch,
    coordinates,
    expectedHeadOid: expectedHeadSha,
    fileChanges,
    message: request.message,
  });

  return { commitSha: commit.oid, commitUrl: commit.url, outcome: 'committed' };
}
