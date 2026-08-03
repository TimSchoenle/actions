import { fileURLToPath } from 'node:url';

import { runAction, ScratchRepo } from 'actions-e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/maintenance/auto-approve-pr`, replacing the four jobs of
 * `verify-action-maintenance-auto-approve-pr.yaml`.
 *
 * Two identities are unavoidable here, which is why the workflow minted a second app token as well:
 * GitHub rejects a review submitted by the pull request's own author, so the account that opens the
 * fixture cannot be the account that approves it. The fixture is opened with the primary token and
 * the action runs with `E2E_GITHUB_TOKEN_SECONDARY`.
 *
 * The action publishes no outputs — approving is its entire effect — so every case asserts on the
 * review state GitHub actually recorded.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

/**
 * Matches the branch names release-please produces, which is what this action exists to approve.
 *
 * Anchored on the tail rather than the head because every branch a case creates lives under the
 * `test/<action>/<run>/` namespace the janitor sweeps by. The property under test — a branch that
 * matches is approved and one that does not is left alone — is unaffected by the prefix.
 */
const RELEASE_PATTERN = '^.*/release-please--branches--main$';

describe('auto-approve-pr', () => {
  const scratch = ScratchRepo.fromEnvironment('auto-approve-pr');

  let defaultBranch: string;
  let authorId: string;

  beforeAll(async () => {
    defaultBranch = await scratch.defaultBranch();
    authorId = String(await scratch.accountId());
  });

  afterAll(() => scratch.teardown());

  /** Opens a pull request from `branch`, authored by the primary identity. */
  async function openPullRequest(branch: string, caseName: string): Promise<number> {
    await scratch.createBranch(branch);
    await scratch.commitFile(
      branch,
      `${branch}/file.txt`,
      `content for ${caseName}\n`,
      `test: fixture for ${caseName}`,
    );

    return scratch.createPullRequest(branch, defaultBranch, `[e2e] ${caseName}`);
  }

  /** Runs the action as the *second* identity, which is the only one allowed to review. */
  function approve(number: number, inputs: ProvidedInputs<ActionInput>): ReturnType<typeof runAction> {
    const token = scratch.secondaryToken;

    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: {
        token,
        pr_url: `https://github.com/${scratch.repository}/pull/${number}`,
        ignore_empty_prs: 'true',
        ...inputs,
      },
      secrets: [token, scratch.token],
    });
  }

  it('approves a pull request opened by an allowed author', async () => {
    const number = await openPullRequest(scratch.branch('allowed'), 'allowed author');

    await approve(number, { user_ids: authorId, branch_pattern: '.*' });

    await expect(scratch.reviewStates(number)).resolves.toContain('APPROVED');
  });

  it('leaves a pull request from an author outside the allowlist alone', async () => {
    const number = await openPullRequest(scratch.branch('not-allowed'), 'author outside the allowlist');

    await approve(number, { user_ids: '12345', branch_pattern: '.*' });

    await expect(scratch.reviewStates(number)).resolves.not.toContain('APPROVED');
  });

  it('approves a branch matching the pattern', async () => {
    const number = await openPullRequest(scratch.branch('release-please--branches--main'), 'branch pattern match');

    await approve(number, { user_ids: authorId, branch_pattern: RELEASE_PATTERN });

    await expect(scratch.reviewStates(number)).resolves.toContain('APPROVED');
  });

  it('leaves a branch that does not match the pattern alone', async () => {
    const number = await openPullRequest(scratch.branch('pattern-mismatch'), 'branch pattern mismatch');

    await approve(number, { user_ids: authorId, branch_pattern: RELEASE_PATTERN });

    await expect(scratch.reviewStates(number)).resolves.not.toContain('APPROVED');
  });

  // `reject_forks` must reject pull requests *from a fork*, not same-repository ones. Getting this
  // backwards would silently stop every release-please approval, so it is asserted explicitly.
  it('still approves a same-repository pull request when forks are rejected', async () => {
    const number = await openPullRequest(scratch.branch('reject-forks'), 'same-repository with reject_forks');

    await approve(number, { user_ids: authorId, branch_pattern: '.*', reject_forks: 'true' });

    await expect(scratch.reviewStates(number)).resolves.toContain('APPROVED');
  });

  it('uses the approval message it was given', async () => {
    const number = await openPullRequest(scratch.branch('message'), 'custom approval message');
    const message = 'Auto-approved by the end-to-end suite.';

    await approve(number, { user_ids: authorId, branch_pattern: '.*', auto_approve_message: message });

    await expect(scratch.reviewStates(number)).resolves.toContain('APPROVED');
    await expect(scratch.reviewBodies(number)).resolves.toContain(message);
  });
});
