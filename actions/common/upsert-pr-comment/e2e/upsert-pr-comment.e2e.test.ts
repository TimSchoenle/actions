import { fileURLToPath } from 'node:url';

import { runAction, ScratchRepo } from 'actions-e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { markerFor } from '../src/marker.js';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs, WorkspaceFiles } from 'actions-e2e';

/**
 * End-to-end cases for `actions/common/upsert-pr-comment`.
 *
 * The point of the action is what happens on the *second* run, which no unit test can settle:
 * whether GitHub still hands back the comment the first run wrote, and whether the hidden marker
 * survives its own round trip through the API. Every case here therefore runs the action twice and
 * asserts on comment *identity*, not only on the body — two runs reporting the same thing are
 * indistinguishable by body alone.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('upsert-pr-comment', () => {
  const scratch = ScratchRepo.fromEnvironment('upsert-pr-comment');

  let defaultBranch: string;

  function run(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
    files?: WorkspaceFiles,
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { token: scratch.token, ...inputs },
      secrets: [scratch.token],
      expect: expected,
      files,
    });
  }

  /** Opens a pull request carrying one commit, which is the minimum GitHub will accept. */
  async function openPullRequest(caseName: string): Promise<string> {
    const branch = scratch.branch(caseName);

    await scratch.createBranch(branch);
    await scratch.commitFile(branch, `${branch}/file.txt`, `content for ${caseName}\n`, `test: fixture ${caseName}`);

    const number = await scratch.createPullRequest(branch, defaultBranch, `[e2e] ${caseName}`);

    return `https://github.com/${scratch.repository}/pull/${number}`;
  }

  /** The number a pull request URL ends in, for reading the comments back off it. */
  function numberOf(prUrl: string): number {
    return Number(prUrl.split('/').at(-1));
  }

  beforeAll(async () => {
    defaultBranch = await scratch.defaultBranch();
  });

  afterAll(() => scratch.teardown());

  it('posts a comment carrying the hidden marker', async () => {
    const prUrl = await openPullRequest('create');

    const result = await run({ pr_url: prUrl, identifier: 'size', body: 'image is 12 MB' });

    expect(result.outputs.operation).toBe('created');

    const comments = await scratch.issueCommentRecords(numberOf(prUrl));

    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe(Number(result.outputs.comment_id));
    expect(comments[0].body).toBe(`${markerFor('size')}\n\nimage is 12 MB`);
  });

  it('rewrites its own comment on a later run instead of adding one', async () => {
    const prUrl = await openPullRequest('update');

    const first = await run({ pr_url: prUrl, identifier: 'size', body: 'image is 12 MB' });
    const second = await run({ pr_url: prUrl, identifier: 'size', body: 'image is 9 MB' });

    expect(second.outputs.operation).toBe('updated');
    expect(second.outputs.comment_id).toBe(first.outputs.comment_id);

    const comments = await scratch.issueCommentRecords(numberOf(prUrl));

    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain('image is 9 MB');
  });

  it('writes nothing at all when the report has not changed', async () => {
    const prUrl = await openPullRequest('unchanged');

    const first = await run({ pr_url: prUrl, identifier: 'size', body: 'image is 12 MB' });
    const second = await run({ pr_url: prUrl, identifier: 'size', body: 'image is 12 MB' });

    expect(second.outputs).toMatchObject({ comment_id: first.outputs.comment_id, operation: 'unchanged' });
    await expect(scratch.issueCommentRecords(numberOf(prUrl))).resolves.toHaveLength(1);
  });

  it('keeps two identifiers on the same pull request apart', async () => {
    const prUrl = await openPullRequest('two-identifiers');

    await run({ pr_url: prUrl, identifier: 'size', body: 'image is 12 MB' });
    await run({ pr_url: prUrl, identifier: 'coverage', body: 'coverage is 91 percent' });
    const again = await run({ pr_url: prUrl, identifier: 'size', body: 'image is 9 MB' });

    expect(again.outputs.operation).toBe('updated');

    const bodies = await scratch.issueComments(numberOf(prUrl));

    expect(bodies).toHaveLength(2);
    expect(bodies.join('\n')).toContain('coverage is 91 percent');
    expect(bodies.join('\n')).toContain('image is 9 MB');
  });

  // The fallback the design turns on: a reviewer deleting last week's comment must not stop this
  // week's report from being posted.
  it('posts a new comment when the one it wrote has been deleted', async () => {
    const prUrl = await openPullRequest('deleted');

    const first = await run({ pr_url: prUrl, identifier: 'size', body: 'image is 12 MB' });
    await scratch.deleteIssueComment(Number(first.outputs.comment_id));

    const second = await run({ pr_url: prUrl, identifier: 'size', body: 'image is 9 MB' });

    expect(second.outputs.operation).toBe('created');
    expect(second.outputs.comment_id).not.toBe(first.outputs.comment_id);
    await expect(scratch.issueCommentRecords(numberOf(prUrl))).resolves.toHaveLength(1);
  });

  it('adds a comment every run when updating is switched off', async () => {
    const prUrl = await openPullRequest('always-new');

    await run({ pr_url: prUrl, identifier: 'size', body: 'run one', update_existing: 'false' });
    const second = await run({ pr_url: prUrl, identifier: 'size', body: 'run two', update_existing: 'false' });

    expect(second.outputs.operation).toBe('created');
    await expect(scratch.issueCommentRecords(numberOf(prUrl))).resolves.toHaveLength(2);
  });

  it('reads the body from a file in the workspace', async () => {
    const prUrl = await openPullRequest('body-file');
    const report = '| image | size |\n| --- | --- |\n| api | 12 MB |\n';

    const result = await run({ pr_url: prUrl, identifier: 'size', body_file: 'reports/size.md' }, 'success', {
      'reports/size.md': report,
    });

    expect(result.outputs.operation).toBe('created');
    await expect(scratch.issueComments(numberOf(prUrl))).resolves.toEqual([`${markerFor('size')}\n\n${report}`]);
  });

  it('ignores a marked comment posted by anyone but the required author', async () => {
    const prUrl = await openPullRequest('author-filter');
    const forged = await scratch.createIssueComment(numberOf(prUrl), `${markerFor('size')}\n\nnot ours`);

    const result = await run({ pr_url: prUrl, identifier: 'size', body: 'image is 12 MB', author: 'nobody[bot]' });

    expect(result.outputs.operation).toBe('created');
    expect(result.outputs.comment_id).not.toBe(String(forged));
    await expect(scratch.issueCommentRecords(numberOf(prUrl))).resolves.toHaveLength(2);
  });

  it('updates a marked comment posted by the required author', async () => {
    const prUrl = await openPullRequest('author-match');
    const seeded = await scratch.createIssueComment(numberOf(prUrl), `${markerFor('size')}\n\nolder`);
    const [{ author }] = await scratch.issueCommentRecords(numberOf(prUrl));

    const result = await run({ pr_url: prUrl, identifier: 'size', body: 'image is 12 MB', author });

    expect(result.outputs).toMatchObject({ comment_id: String(seeded), operation: 'updated' });
  });

  it('fails on a pull request URL it cannot parse', async () => {
    const inputs = { pr_url: 'https://github.com/owner/repo/issues/1', identifier: 'size', body: 'x' };

    const result = await run(inputs, 'failure');

    expect(result.errors.join('\n')).toContain('Invalid pull request URL');
  });
});
