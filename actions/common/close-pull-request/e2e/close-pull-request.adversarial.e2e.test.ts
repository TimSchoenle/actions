import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  expectCleanRejection,
  expectNoInjection,
  INPUT_HOSTILE_CHARACTERS,
  oversized,
  runAction,
  ScratchRepo,
} from 'actions-e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * Hostile cases for `actions/common/close-pull-request`, run against a real repository.
 *
 * Two capabilities to contain. The action *closes* a pull request, so `pull_request_id` must reach
 * the number it names and nothing else — including nothing in another repository. And it *comments*,
 * so whatever it is handed becomes a durable, notifying artefact on a page other people read: an
 * `@team` mention in a bot comment pages a team, and a closing keyword in a comment does nothing,
 * but the same text in a body would close an issue.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('close-pull-request under hostile input', () => {
  const scratch = ScratchRepo.fromEnvironment('close-pull-request-adv');

  let defaultBranch: string;

  function run(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'any',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { token: scratch.token, repository: scratch.repository, ...inputs },
      secrets: [scratch.token],
      expect: expected,
    });
  }

  async function openPullRequest(caseName: string): Promise<number> {
    const branch = scratch.branch(caseName);

    await scratch.createBranch(branch);
    await scratch.commitFile(branch, `${branch}/file.txt`, `content for ${caseName}\n`, `test: fixture ${caseName}`);

    return scratch.createPullRequest(branch, defaultBranch, `[e2e] ${caseName}`);
  }

  beforeAll(async () => {
    defaultBranch = await scratch.defaultBranch();
  });

  afterAll(() => scratch.teardown());

  describe('the pull request it is allowed to close', () => {
    it.each([
      { name: 'a float', value: '1.5' },
      { name: 'scientific notation', value: '1e3' },
      { name: 'hexadecimal', value: '0x1' },
      { name: 'a negative number', value: '-1' },
      { name: 'zero', value: '0' },
      { name: 'a number with a suffix', value: '1abc' },
      { name: 'a leading plus', value: '+1' },
      { name: 'whitespace only', value: '   ' },
      { name: 'a URL rather than a number', value: 'https://github.com/o/r/pull/1' },
      { name: 'a comma-separated list', value: '1,2' },
    ])('refuses $name as a pull request id', async ({ value }) => {
      const result = await run({ pull_request_id: value }, 'failure');

      expectCleanRejection(result);
      expect(result.outputs, 'a rejected id must publish nothing').toEqual({});
      expectNoInjection(result);
    });

    // Not refused, and safe because of where it lands rather than because it was checked: the value
    // rounds to 9007199254740992, no pull request carries that number, and the result is the same
    // `closed=false` any absent one produces. Pinned so that "it rounds" stays a fact about an id
    // that cannot exist, and does not one day become a fact about one that can.
    it('reports an id past the safe integer range as not closed', async () => {
      const result = await run({ pull_request_id: '9007199254740993' }, 'success');

      expect(result.outputs).toEqual({ closed: 'false' });
      expectNoInjection(result);
    });

    // A bystander in the same repository, left open. Nothing addressed at another number, or at a
    // number wrapped in something that only looks numeric, may reach it.
    it('closes only the pull request whose number it was given', async () => {
      const target = await openPullRequest('target');
      const bystander = await openPullRequest('bystander');

      const result = await run({ pull_request_id: String(target) }, 'success');

      expect(result.outputs).toEqual({ closed: 'true' });
      await expect(scratch.pullRequest(target)).resolves.toMatchObject({ state: 'closed' });
      await expect(scratch.pullRequest(bystander), 'the neighbour must stay open').resolves.toMatchObject({
        state: 'open',
      });
    });

    it('reports a number in another repository as not closed, without reaching it', async () => {
      // A public pull request that exists but is not ours. The token cannot act on it, and the action
      // must report that as `closed=false` rather than as success.
      const result = await run({ repository: 'octocat/Hello-World', pull_request_id: '1' });

      expect(result.outputs['closed']).not.toBe('true');
      expectNoInjection(result);
    });

    it.each([
      { name: 'no slash', value: 'justaname' },
      { name: 'too many segments', value: 'owner/repo/extra' },
      { name: 'a parent walk', value: 'owner/../other' },
      { name: 'a URL rather than a slug', value: 'https://github.com/owner/repo' },
    ])('refuses a repository slug with $name', async ({ value }) => {
      const result = await run({ repository: value, pull_request_id: '1' }, 'failure');

      expect(result.outputs).toEqual({});
      expectNoInjection(result);
    });
  });

  describe('the comment it posts', () => {
    it('posts a hostile comment as text, and nothing it contains takes effect here', async () => {
      const number = await openPullRequest('hostile-comment');
      const comment = commandInjectionPayload('Closed by the suite.');

      const result = await run({ pull_request_id: String(number), comment }, 'success');

      expect(result.outputs).toEqual({ closed: 'true' });
      // Posted verbatim: this action's contract is to relay the comment its caller composed, and
      // sanitising it here would silently corrupt a legitimate changelog. What must not happen is the
      // text acting on *this* run.
      await expect(scratch.issueComments(number)).resolves.toEqual([comment]);
      expectNoInjection(result);
    });

    it('posts no comment at all when none was asked for', async () => {
      const number = await openPullRequest('no-comment');

      await run({ pull_request_id: String(number) }, 'success');

      await expect(scratch.issueComments(number)).resolves.toEqual([]);
    });

    it('does not comment on a pull request it could not close', async () => {
      const result = await run({ pull_request_id: '999999999', comment: commandInjectionPayload('never posted') });

      expect(result.outputs).toEqual({ closed: 'false' });
      expectNoInjection(result);
    });

    it('carries a comment far larger than a person would write', async () => {
      const number = await openPullRequest('huge-comment');

      const result = await run({ pull_request_id: String(number), comment: oversized(60_000) }, 'any');

      // Either it posts or GitHub refuses the body; both are decisions. A crash is not.
      expect(result.stderr).not.toContain('UnhandledPromiseRejection');
      expectNoInjection(result);
    });
  });

  describe('injection through the inputs', () => {
    it.each([
      { name: 'the pull request id', input: 'pull_request_id' as const },
      { name: 'the repository', input: 'repository' as const },
    ])('forges nothing through $name', async ({ input }) => {
      const result = await run({ pull_request_id: '1', [input]: commandInjectionPayload('1') }, 'any');

      expectNoInjection(result);
    });

    it.each(INPUT_HOSTILE_CHARACTERS)('forges nothing through $name ($risk) in the id', async ({ value }) => {
      const result = await run({ pull_request_id: `1${value}` }, 'any');

      expectNoInjection(result);
    });

    it('never echoes the token', async () => {
      const result = await run({ pull_request_id: commandInjectionPayload('1') }, 'any');

      expect(result.stdout).not.toContain(scratch.token);
      expect(result.stderr).not.toContain(scratch.token);
    });
  });
});
