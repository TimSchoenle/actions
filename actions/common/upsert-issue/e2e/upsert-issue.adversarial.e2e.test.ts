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
import { afterAll, describe, expect, it } from 'vitest';

import { markerFor, MAX_ISSUE_BODY_LENGTH } from '../src/marker.js';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs, WorkspaceFiles } from 'actions-e2e';

/**
 * Hostile inputs for `actions/common/upsert-issue`.
 *
 * Two distinct properties, and they pull in opposite directions. The *identifier* is structural: it
 * ends up inside an HTML comment that a later run has to find again, so anything that could close
 * that comment or break the line has to be refused outright. The *body* is data: it is markdown a
 * caller wants posted verbatim, hostile or not, and the only rule is that it must never reach the step
 * log in a form the runner parses as a workflow command.
 *
 * Unlike `upsert-pr-comment`, there is no fixture to open first: an issue is opened directly on the
 * repository rather than attached to something that already exists, so every case supplies its own
 * unique identifier and needs no shared setup.
 *
 * One case `upsert-pr-comment`'s suite has that this one deliberately does not: deleting the target
 * between scan and write to prove the `IssueUnavailableError` fallback. Deleting a comment needs only
 * ordinary write access, but GitHub's `deleteIssue` mutation requires the *administration* permission
 * -- a scope far broader than this action, or its fixtures, otherwise need -- so that fallback path is
 * proved at the unit level instead (`github-api.test.ts`'s 404/410 mapping and `upsert.test.ts`'s
 * fallback case), not against the real API.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('upsert-issue (adversarial)', () => {
  const scratch = ScratchRepo.fromEnvironment('upsert-issue-adv');

  // See the non-adversarial suite for why: the shared scratch repository's history is almost
  // entirely pull requests, and `search_state: open` keeps a fresh identifier's "not found" scan cheap.
  function run(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'failure',
    files?: WorkspaceFiles,
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: {
        repository: scratch.repository,
        search_state: 'open',
        title: '[e2e] adversarial',
        token: scratch.token,
        ...inputs,
      },
      secrets: [scratch.token],
      expect: expected,
      files,
    });
  }

  afterAll(() => scratch.teardown());

  async function trackIfOpened(result: ActionRunResult<ActionOutput>): Promise<void> {
    if (result.outputs.issue_number !== undefined && result.outputs.issue_number !== '') {
      scratch.trackIssue(Number(result.outputs.issue_number));
    }
  }

  describe('identifier', () => {
    it('refuses one that would close the marker and inject markdown after it', async () => {
      const result = await run({ body: 'report', identifier: 'size --><img src=x onerror=alert(1)>' });

      expectCleanRejection(result, /identifier must be/);
    });

    // The character sits *inside* the identifier rather than at its end. Inputs arrive as
    // environment variables and `@actions/core` trims them, so a trailing carriage return, line feed
    // or line separator is gone before the action ever sees it: a case shaped that way would assert
    // on `@actions/core`'s trimming instead of on this action refusing the character.
    it.each(INPUT_HOSTILE_CHARACTERS)('refuses one carrying $name, which $risk', async ({ value }) => {
      const result = await run({ body: 'report', identifier: `size${value}report` });

      expectCleanRejection(result);
      expectNoInjection(result);
    });

    it('refuses one long enough to bury the body', async () => {
      const result = await run({ body: 'report', identifier: 'x'.repeat(1000) });

      expectCleanRejection(result, /identifier must be/);
    });

    it('refuses an empty one rather than opening an unfindable issue', async () => {
      const result = await run({ body: 'report', identifier: '' });

      expectCleanRejection(result);
    });
  });

  describe('body', () => {
    it('opens an issue full of workflow commands without letting the runner see them', async () => {
      const payload = commandInjectionPayload('repo is healthy');

      const result = await run({ body: payload, identifier: 'injected-body' }, 'success');
      await trackIfOpened(result);

      expectNoInjection(result);

      // The payload is data, and data is posted: refusing it would make the action useless for the
      // reports it exists to publish. What must not happen is the runner reading it as a command.
      const record = await scratch.issueRecord(Number(result.outputs.issue_number));
      expect(record.body).toContain(payload);
    });

    it('cuts an oversized body to what GitHub accepts instead of failing the build', async () => {
      const result = await run({ body: oversized(MAX_ISSUE_BODY_LENGTH), identifier: 'oversized' }, 'success');
      await trackIfOpened(result);

      expect(result.warnings.join('\n')).toContain('cut short');

      const record = await scratch.issueRecord(Number(result.outputs.issue_number));

      expect(record.body).toContain(markerFor('oversized'));
      expect(record.body?.length).toBeLessThanOrEqual(MAX_ISSUE_BODY_LENGTH);
    });
  });

  describe('body_file', () => {
    it.each(TRAVERSAL_PATHS)('refuses $name', async ({ value }) => {
      const result = await run({ body_file: value, identifier: 'traversal' });

      expectCleanRejection(result);
      expectNoInjection(result);
    });

    it('refuses both body and body_file rather than choosing one', async () => {
      const result = await run({ body: 'inline', body_file: 'report.md', identifier: 'both' }, 'failure', {
        'report.md': 'from the file',
      });

      expectCleanRejection(result, /only one of/);
    });
  });

  describe('repository', () => {
    it.each([
      ['a bare word', 'not-a-repository'],
      ['a URL rather than owner/repo', 'https://github.com/owner/repo'],
      ['a trailing slash', 'owner/repo/'],
    ])('refuses %s', async (_name, repository) => {
      const result = await run({ body: 'report', identifier: 'size', repository });

      expectCleanRejection(result, /Invalid repository/);
    });
  });

  describe('search_state', () => {
    it('refuses a value that is neither open nor all', async () => {
      const result = await run({ body: 'report', identifier: 'size', search_state: 'closed' });

      expectCleanRejection(result, /search_state/);
    });
  });
});
