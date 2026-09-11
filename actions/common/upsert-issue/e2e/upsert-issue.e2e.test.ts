import { fileURLToPath } from 'node:url';

import { runAction, ScratchRepo } from 'actions-e2e';
import { afterAll, describe, expect, it } from 'vitest';

import { markerFor } from '../src/marker.js';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs, WorkspaceFiles } from 'actions-e2e';

/**
 * End-to-end cases for `actions/common/upsert-issue`.
 *
 * The point of the action is what happens on the *second* run, which no unit test can settle:
 * whether GitHub still hands back the issue the first run opened, whether the hidden marker survives
 * its own round trip through the API, and whether the open/closed state and label set converge the way
 * the decision table says they should. Every case here therefore runs the action twice (or seeds a
 * fixture through the raw API) and asserts on issue *identity*, not only on its fields -- two runs
 * reporting the same thing are indistinguishable by fields alone.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('upsert-issue', () => {
  const scratch = ScratchRepo.fromEnvironment('upsert-issue');

  function run(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
    files?: WorkspaceFiles,
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { repository: scratch.repository, token: scratch.token, ...inputs },
      secrets: [scratch.token],
      expect: expected,
      files,
    });
  }

  afterAll(() => scratch.teardown());

  it('opens an issue carrying the hidden marker', async () => {
    const result = await run({ body: 'repo is healthy', identifier: 'repo-state', title: '[e2e] create' });
    scratch.trackIssue(Number(result.outputs.issue_number));

    expect(result.outputs.operation).toBe('created');

    const record = await scratch.issueRecord(Number(result.outputs.issue_number));

    expect(record.title).toBe('[e2e] create');
    expect(record.body).toBe(`${markerFor('repo-state')}\n\nrepo is healthy`);
  });

  it('rewrites the title and body on a later run instead of opening one', async () => {
    const first = await run({ body: 'v1', identifier: 'repo-state', title: '[e2e] update v1' });
    scratch.trackIssue(Number(first.outputs.issue_number));

    const second = await run({ body: 'v2', identifier: 'repo-state', title: '[e2e] update v2' });

    expect(second.outputs.operation).toBe('updated');
    expect(second.outputs.issue_number).toBe(first.outputs.issue_number);

    const record = await scratch.issueRecord(Number(second.outputs.issue_number));

    expect(record.title).toBe('[e2e] update v2');
    expect(record.body).toContain('v2');
  });

  it('writes nothing at all when nothing has changed', async () => {
    const inputs = { body: 'steady', identifier: 'repo-state', title: '[e2e] unchanged' };
    const first = await run(inputs);
    scratch.trackIssue(Number(first.outputs.issue_number));

    const second = await run(inputs);

    expect(second.outputs).toMatchObject({ issue_number: first.outputs.issue_number, operation: 'unchanged' });
  });

  it('reopens a closed matching issue whose content already matches', async () => {
    const inputs = { body: 'still true', identifier: 'repo-state', title: '[e2e] reopen' };
    const first = await run(inputs);
    scratch.trackIssue(Number(first.outputs.issue_number));
    await scratch.closeIssue(Number(first.outputs.issue_number));

    const second = await run(inputs);

    expect(second.outputs).toMatchObject({ issue_number: first.outputs.issue_number, operation: 'reopened' });
    await expect(scratch.issueRecord(Number(second.outputs.issue_number))).resolves.toMatchObject({ state: 'open' });
  });

  it('updates a closed matching issue in place and leaves it closed when reopen_if_closed is false', async () => {
    const first = await run({
      body: 'v1',
      identifier: 'repo-state',
      reopen_if_closed: 'false',
      title: '[e2e] stay-closed',
    });
    scratch.trackIssue(Number(first.outputs.issue_number));
    await scratch.closeIssue(Number(first.outputs.issue_number));

    const second = await run({
      body: 'v2',
      identifier: 'repo-state',
      reopen_if_closed: 'false',
      title: '[e2e] stay-closed',
    });

    expect(second.outputs.operation).toBe('updated');

    const record = await scratch.issueRecord(Number(second.outputs.issue_number));

    expect(record.state).toBe('closed');
    expect(record.body).toContain('v2');
  });

  it('enforces the label set on every run, adding and removing as the input changes', async () => {
    const first = await run({
      body: 'x',
      identifier: 'repo-state',
      labels: 'e2e-bug',
      title: '[e2e] labels',
    });
    scratch.trackIssue(Number(first.outputs.issue_number));
    await expect(scratch.issueRecord(Number(first.outputs.issue_number))).resolves.toMatchObject({
      labels: ['e2e-bug'],
    });

    const second = await run({
      body: 'x',
      identifier: 'repo-state',
      labels: 'e2e-enhancement',
      title: '[e2e] labels',
    });

    expect(second.outputs.operation).toBe('updated');
    await expect(scratch.issueRecord(Number(second.outputs.issue_number))).resolves.toMatchObject({
      labels: ['e2e-enhancement'],
    });
  });

  it('keeps two identifiers in the same repository apart', async () => {
    const state = await run({ body: 'state', identifier: 'two-ids-state', title: '[e2e] state' });
    scratch.trackIssue(Number(state.outputs.issue_number));
    const coverage = await run({ body: 'coverage', identifier: 'two-ids-coverage', title: '[e2e] coverage' });
    scratch.trackIssue(Number(coverage.outputs.issue_number));

    const again = await run({ body: 'state v2', identifier: 'two-ids-state', title: '[e2e] state' });

    expect(again.outputs.operation).toBe('updated');
    expect(again.outputs.issue_number).toBe(state.outputs.issue_number);
    expect(again.outputs.issue_number).not.toBe(coverage.outputs.issue_number);
  });

  it('opens a new issue every run when updating is switched off', async () => {
    const first = await run({
      body: 'run one',
      identifier: 'always-new',
      title: '[e2e] always-new',
      update_existing: 'false',
    });
    scratch.trackIssue(Number(first.outputs.issue_number));

    const second = await run({
      body: 'run two',
      identifier: 'always-new',
      title: '[e2e] always-new',
      update_existing: 'false',
    });
    scratch.trackIssue(Number(second.outputs.issue_number));

    expect(second.outputs.operation).toBe('created');
    expect(second.outputs.issue_number).not.toBe(first.outputs.issue_number);
  });

  it('reads the body from a file in the workspace', async () => {
    const report = '| repo | state |\n| --- | --- |\n| api | healthy |\n';

    const result = await run(
      { body_file: 'reports/state.md', identifier: 'body-file', title: '[e2e] body-file' },
      'success',
      { 'reports/state.md': report },
    );
    scratch.trackIssue(Number(result.outputs.issue_number));

    await expect(scratch.issueRecord(Number(result.outputs.issue_number))).resolves.toMatchObject({
      body: `${markerFor('body-file')}\n\n${report}`,
    });
  });

  it('ignores a marked issue opened by anyone but the required author', async () => {
    const forged = await scratch.createIssueRecord('[e2e] forged', `${markerFor('author-filter')}\n\nnot ours`);

    const result = await run({
      author: 'nobody-at-all',
      body: 'ours',
      identifier: 'author-filter',
      title: '[e2e] author-filter',
    });
    scratch.trackIssue(Number(result.outputs.issue_number));

    expect(result.outputs.operation).toBe('created');
    expect(result.outputs.issue_number).not.toBe(String(forged.number));
  });

  it('updates a marked issue opened by the required author', async () => {
    const seeded = await scratch.createIssueRecord('[e2e] author-match', `${markerFor('author-match')}\n\nolder`);
    const { author } = await scratch.issueRecord(seeded.number);

    const result = await run({ author, body: 'newer', identifier: 'author-match', title: '[e2e] author-match' });

    expect(result.outputs).toMatchObject({ issue_number: String(seeded.number), operation: 'updated' });
  });

  it('does not find a closed match when search_state is open, and opens a new issue instead', async () => {
    const seeded = await scratch.createIssueRecord('[e2e] open-only', `${markerFor('open-only')}\n\nold`);
    await scratch.closeIssue(seeded.number);

    const result = await run({
      body: 'new',
      identifier: 'open-only',
      search_state: 'open',
      title: '[e2e] open-only',
    });
    scratch.trackIssue(Number(result.outputs.issue_number));

    expect(result.outputs.operation).toBe('created');
    expect(result.outputs.issue_number).not.toBe(String(seeded.number));
  });

  it('fails on a repository it cannot parse', async () => {
    const result = await run({ body: 'x', identifier: 'size', repository: 'not-a-repository', title: 'x' }, 'failure');

    expect(result.errors.join('\n')).toContain('Invalid repository');
  });
});
