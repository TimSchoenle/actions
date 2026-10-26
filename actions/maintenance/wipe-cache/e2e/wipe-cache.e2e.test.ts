import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  expectCleanRejection,
  expectNoInjection,
  expectSecretNotLeaked,
  runAction,
  ScratchRepo,
} from 'actions-e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/maintenance/wipe-cache`.
 *
 * The suite's token is scoped to `metadata: read`, so every case here stops before the cache API:
 * the refusals, which have to hold before anything is listed, and the tag-delete skip, which must
 * not reach the API at all. Deleting real entries is covered by the unit suite against a fake store.
 * A case that lists or deletes needs `actions: write` granted to the test app first, and the scratch
 * repository has no workflow that saves caches for one to find.
 *
 * `repository` and `branch` default to `${{ }}` expressions only the runner resolves, so every case
 * passes both.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('wipe-cache', () => {
  const scratch = ScratchRepo.fromEnvironment('wipe-cache');
  let eventDirectory: string;

  beforeAll(() => {
    eventDirectory = mkdtempSync(path.join(tmpdir(), 'wipe-cache-e2e-'));
  });

  afterAll(async () => {
    rmSync(eventDirectory, { force: true, recursive: true });
    await scratch.teardown();
  });

  function run(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome,
    env: Record<string, string> = {},
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { token: scratch.token, repository: scratch.repository, ...inputs },
      secrets: [scratch.token],
      expect: expected,
      env,
    });
  }

  /** Writes a `delete` event payload the way the runner does, and returns the environment naming it. */
  function deleteEvent(refType: 'branch' | 'tag', ref: string): Record<string, string> {
    const eventPath = path.join(eventDirectory, `${refType}.json`);
    writeFileSync(eventPath, JSON.stringify({ ref, ref_type: refType }));

    return { GITHUB_EVENT_NAME: 'delete', GITHUB_EVENT_PATH: eventPath };
  }

  it('refuses the default branch, by name and by full ref', async () => {
    const defaultBranch = await scratch.defaultBranch();

    for (const branch of [defaultBranch, `refs/heads/${defaultBranch}`]) {
      const result = await run({ branch }, 'failure');

      expectCleanRejection(result, /Refusing to wipe the caches of .*the default branch/);
      expect(result.outputs).toEqual({});
    }
  });

  it('refuses an empty branch, which a trigger other than delete leaves behind', async () => {
    const result = await run({ branch: '' }, 'failure', { GITHUB_EVENT_NAME: 'push' });

    expectCleanRejection(result, /No branch to wipe/);
    expect(result.outputs).toEqual({});
  });

  it('refuses a ref that is not a branch', async () => {
    const result = await run({ branch: 'refs/tags/v1.0.0' }, 'failure');

    expectCleanRejection(result, /only branches can be wiped/);
  });

  // The delete event fires for tags too, and its ref would otherwise be read as a branch name.
  it('skips a deleted tag without touching the API', async () => {
    const result = await run({ branch: 'v1.0.0' }, 'success', deleteEvent('tag', 'v1.0.0'));

    expect(result.notices.join('\n')).toContain('the delete event removed a tag, not a branch');
    expect(result.outputs).toEqual({ matched_count: '0', deleted_count: '0', failed_count: '0' });
  });

  it('still refuses the default branch when a delete event names it', async () => {
    const defaultBranch = await scratch.defaultBranch();

    const result = await run({ branch: defaultBranch }, 'failure', deleteEvent('branch', defaultBranch));

    expectCleanRejection(result, /Refusing to wipe/);
  });

  describe('under hostile input', () => {
    it('rejects a branch that forges workflow commands, without any taking effect', async () => {
      const result = await run({ branch: commandInjectionPayload() }, 'failure');

      expectCleanRejection(result, /Invalid branch/);
      expectNoInjection(result);
    });

    it('never echoes the token', async () => {
      const result = await run({ branch: await scratch.defaultBranch() }, 'failure');

      expectSecretNotLeaked(result, scratch.token);
    });
  });
});
