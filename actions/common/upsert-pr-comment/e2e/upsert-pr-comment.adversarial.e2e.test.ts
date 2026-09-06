import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  expectCleanRejection,
  expectNoInjection,
  INPUT_HOSTILE_CHARACTERS,
  oversized,
  runAction,
  ScratchRepo,
  TRAVERSAL_PATHS,
} from 'actions-e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { markerFor, MAX_COMMENT_LENGTH } from '../src/marker.js';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs, WorkspaceFiles } from 'actions-e2e';

/**
 * Hostile inputs for `actions/common/upsert-pr-comment`.
 *
 * Two distinct properties, and they pull in opposite directions. The *identifier* is structural: it
 * ends up inside an HTML comment that a later run has to find again, so anything that could close
 * that comment or break the line has to be refused outright. The *body* is data: it is markdown a
 * caller wants posted verbatim, hostile or not, and the only rule is that it must never reach the
 * step log in a form the runner parses as a workflow command.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('upsert-pr-comment (adversarial)', () => {
  const scratch = ScratchRepo.fromEnvironment('upsert-pr-comment-adv');

  let prUrl: string;
  let prNumber: number;

  function run(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'failure',
    files?: WorkspaceFiles,
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { token: scratch.token, pr_url: prUrl, ...inputs },
      secrets: [scratch.token],
      expect: expected,
      files,
    });
  }

  beforeAll(async () => {
    const defaultBranch = await scratch.defaultBranch();
    const branch = scratch.branch('adversarial');

    await scratch.createBranch(branch);
    await scratch.commitFile(branch, `${branch}/file.txt`, 'content\n', 'test: adversarial fixture');

    prNumber = await scratch.createPullRequest(branch, defaultBranch, '[e2e] adversarial');
    prUrl = `https://github.com/${scratch.repository}/pull/${prNumber}`;
  });

  afterAll(() => scratch.teardown());

  describe('identifier', () => {
    it('refuses one that would close the marker and inject markdown after it', async () => {
      const result = await run({ identifier: 'size --><img src=x onerror=alert(1)>', body: 'report' });

      expectCleanRejection(result, /identifier must be/);
      await expect(scratch.issueComments(prNumber)).resolves.toEqual([]);
    });

    it.each(INPUT_HOSTILE_CHARACTERS)('refuses one carrying $name, which $risk', async ({ value }) => {
      const result = await run({ identifier: `size${value}`, body: 'report' });

      expectCleanRejection(result);
      expectNoInjection(result);
    });

    it('refuses one long enough to bury the body', async () => {
      const result = await run({ identifier: 'x'.repeat(1000), body: 'report' });

      expectCleanRejection(result, /identifier must be/);
    });

    it('refuses an empty one rather than posting an unfindable comment', async () => {
      const result = await run({ identifier: '', body: 'report' });

      expectCleanRejection(result);
    });
  });

  describe('body', () => {
    it('posts a body full of workflow commands without letting the runner see them', async () => {
      const payload = commandInjectionPayload('image is 12 MB');

      const result = await run({ identifier: 'injected-body', body: payload }, 'success');

      expectNoInjection(result);

      // The payload is data, and data is posted: refusing it would make the action useless for the
      // reports it exists to publish. What must not happen is the runner reading it as a command.
      const bodies = await scratch.issueComments(prNumber);
      expect(bodies.some((body) => body.includes(payload))).toBe(true);
    });

    it('cuts an oversized body to what GitHub accepts instead of failing the build', async () => {
      const result = await run({ identifier: 'oversized', body: oversized(MAX_COMMENT_LENGTH) }, 'success');

      expect(result.warnings.join('\n')).toContain('cut short');

      const posted = (await scratch.issueComments(prNumber)).find((body) => body.includes(markerFor('oversized')));

      expect(posted).toBeDefined();
      expect(posted?.length).toBeLessThanOrEqual(MAX_COMMENT_LENGTH);
    });
  });

  describe('body_file', () => {
    it.each(TRAVERSAL_PATHS)('refuses $name', async ({ value }) => {
      const result = await run({ identifier: 'traversal', body_file: value });

      expectCleanRejection(result);
      expectNoInjection(result);
    });

    it('refuses both body and body_file rather than choosing one', async () => {
      const result = await run({ identifier: 'both', body: 'inline', body_file: 'report.md' }, 'failure', {
        'report.md': 'from the file',
      });

      expectCleanRejection(result, /only one of/);
    });
  });

  describe('pull request url', () => {
    it.each([
      ['a bare word', 'not-a-url'],
      ['an issue rather than a pull request', 'https://github.com/owner/repo/issues/1'],
      ['a number that is not one', 'https://github.com/owner/repo/pull/abc'],
    ])('refuses %s', async (_name, url) => {
      const result = await run({ pr_url: url, identifier: 'size', body: 'report' });

      expectCleanRejection(result, /Invalid pull request URL/);
    });
  });
});
