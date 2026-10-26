import { fileURLToPath } from 'node:url';

import { expectNoInjection, expectSecretNotLeaked, runAction, ScratchRepo } from 'actions-e2e';
import { hasStatus } from 'actions-util';
import { createOctokit } from 'actions-util/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/maintenance/auto-rebase`, against real pull requests.
 *
 * The action acts on every open pull request in the repository that carries its label, and the
 * scratch repository is shared with every other suite and every concurrent run. The label is
 * therefore unique to this run, so no other suite's pull request can be matched, and it is deleted
 * again on teardown.
 *
 * The update-branch API answers 202 and merges in the background, so a case asserting on the new
 * head polls for it rather than reading it once.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

/** How long the background merge may take before a case gives up on seeing it. */
const MERGE_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('auto-rebase', () => {
  const scratch = ScratchRepo.fromEnvironment('auto-rebase');
  const octokit = createOctokit(scratch.token);
  const label = scratch.identifier('label');
  const conflictPath = `e2e/auto-rebase/${scratch.identifier('conflict')}.txt`;

  let base: string;
  let behind: string;
  let behindHead: string;
  let behindNumber: number;
  let conflicting: string;
  let conflictingHead: string;
  let conflictingNumber: number;
  let unlabelled: string;
  let unlabelledHead: string;
  let baseHead: string;

  function run(inputs: ProvidedInputs<ActionInput> = {}): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { token: scratch.token, repository: scratch.repository, label, ...inputs },
      secrets: [scratch.token],
    });
  }

  async function addLabel(number: number): Promise<void> {
    await octokit.rest.issues.addLabels({
      issue_number: number,
      labels: [label],
      owner: scratch.owner,
      repo: scratch.repo,
    });
  }

  /** Waits for a branch to move off `previous`, which is how the background merge becomes visible. */
  async function movedHead(branch: string, previous: string): Promise<string> {
    const deadline = Date.now() + MERGE_TIMEOUT_MS;

    for (;;) {
      const sha = await scratch.refSha(branch);

      if (sha !== undefined && sha !== previous) {
        return sha;
      }

      if (Date.now() > deadline) {
        throw new Error(`${branch} did not move off ${previous} within ${MERGE_TIMEOUT_MS / 1000}s.`);
      }

      await sleep(POLL_INTERVAL_MS);
    }
  }

  beforeAll(async () => {
    base = scratch.branch('base');
    await scratch.createBranch(base);
    const conflictBase = await scratch.commitFile(base, conflictPath, 'base\n', 'test: seed the conflicting file');

    // Behind its base, with no overlapping change: the update merges cleanly.
    behind = scratch.branch('behind');
    await scratch.createBranch(behind, conflictBase);
    behindHead = await scratch.commitFile(
      behind,
      `e2e/auto-rebase/${scratch.identifier('behind')}.txt`,
      'head\n',
      'test: change on the head',
    );
    behindNumber = await scratch.createPullRequest(behind, base, 'auto-rebase e2e: behind');
    await addLabel(behindNumber);

    // Behind its base, and both sides rewrite the same line: GitHub rejects the update.
    conflicting = scratch.branch('conflicting');
    await scratch.createBranch(conflicting, conflictBase);
    conflictingHead = await scratch.commitFile(conflicting, conflictPath, 'head\n', 'test: conflicting change');
    conflictingNumber = await scratch.createPullRequest(conflicting, base, 'auto-rebase e2e: conflicting');
    await addLabel(conflictingNumber);

    // Behind its base but unlabelled: must not be touched.
    unlabelled = scratch.branch('unlabelled');
    await scratch.createBranch(unlabelled, conflictBase);
    unlabelledHead = await scratch.commitFile(
      unlabelled,
      `e2e/auto-rebase/${scratch.identifier('unlabelled')}.txt`,
      'head\n',
      'test: unlabelled change',
    );
    await scratch.createPullRequest(unlabelled, base, 'auto-rebase e2e: unlabelled');

    baseHead = await scratch.commitFile(base, conflictPath, 'base moved on\n', 'test: move the base');
  });

  afterAll(async () => {
    try {
      await octokit.rest.issues.deleteLabel({ name: label, owner: scratch.owner, repo: scratch.repo });
    } catch (error) {
      if (!hasStatus(error, 404)) {
        throw error;
      }
    } finally {
      await scratch.teardown();
    }
  });

  it('merges the base into a labelled pull request and reports a conflict without failing', async () => {
    const result = await run();

    expect(result.outputs).toEqual({
      updated: JSON.stringify([behindNumber]),
      skipped: '[]',
      failed: JSON.stringify([conflictingNumber]),
    });
    expect(result.warnings.join('\n')).toContain(`#${conflictingNumber}: GitHub rejected the update`);
    expect(result.stepSummary).toContain(`| #${behindNumber} | updated |`);

    const merged = await movedHead(behind, behindHead);
    const { data: commit } = await octokit.rest.git.getCommit({
      commit_sha: merged,
      owner: scratch.owner,
      repo: scratch.repo,
    });

    expect(commit.parents.map((parent) => parent.sha)).toEqual([behindHead, baseHead]);
    await expect(scratch.refSha(conflicting)).resolves.toBe(conflictingHead);
    await expect(scratch.refSha(unlabelled)).resolves.toBe(unlabelledHead);
  });

  // Runs after the merge above, so the labelled pull request now contains its base.
  it('skips a pull request that is already up to date, matching the label case-insensitively', async () => {
    await movedHead(behind, behindHead);

    const result = await run({ label: label.toUpperCase() });

    expect(result.outputs.skipped).toBe(JSON.stringify([behindNumber]));
    expect(result.outputs.updated).toBe('[]');
    expectNoInjection(result);
    expectSecretNotLeaked(result, scratch.token);
  });

  it('matches nothing for a label no pull request carries', async () => {
    const result = await run({ label: scratch.identifier('unused-label') });

    expect(result.outputs).toEqual({ updated: '[]', skipped: '[]', failed: '[]' });
    expect(result.notices.join('\n')).toContain('No open pull request carries the label');
  });
});
