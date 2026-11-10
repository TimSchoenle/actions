import { fileURLToPath } from 'node:url';

import { runAction, ScratchRepo, UNREACHABLE_API_URL } from 'actions-e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/release/plan-release-please` against the scratch repository.
 *
 * The fixture commits a release-please configuration and manifest on a scratch branch, with the
 * component inside the suite's tag namespace, so the source tags it checks for are tags the janitor
 * sweeps. A release merge needs a merged release pull request, which the scratch repository's default
 * branch must not receive; plan mode is therefore exercised here only for a commit that is not one,
 * and the release path is covered by the unit cases.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const scratch = ScratchRepo.fromEnvironment('plan-release-please');

afterAll(() => scratch.teardown());

describe('plan-release-please', () => {
  let fixture: string;
  let prefix: string;
  let presentTag: string;
  let missingTag: string;

  beforeAll(async () => {
    presentTag = scratch.tag('src-present-v1.0.0');
    missingTag = scratch.tag('src-missing-v2.0.0');
    prefix = presentTag.slice(0, presentTag.lastIndexOf('/') + 1);

    const branch = scratch.branch('fixture');
    await scratch.createBranch(branch);
    const config = {
      packages: {
        'actions/present': { component: `${prefix}src-present` },
        'actions/missing': { component: `${prefix}src-missing` },
      },
    };
    await scratch.commitFile(branch, 'release-please-config.json', JSON.stringify(config), 'test: release config');
    fixture = await scratch.commitFile(
      branch,
      '.release-please-manifest.json',
      JSON.stringify({ 'actions/present': '1.0.0', 'actions/missing': '2.0.0' }),
      'test: release manifest',
    );
    await scratch.createTag(presentTag, fixture);
  });

  function plan(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
    env: Readonly<Record<string, string>> = {},
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      env: { GITHUB_REPOSITORY: scratch.repository, ...env },
      expect: expected,
      inputs: {
        sha: fixture,
        token: scratch.token,
        'source-tag-prefix': `${prefix}src-`,
        ...inputs,
      },
      secrets: [scratch.token],
    });
  }

  // One case, not two: the passing run needs the tag the failing run must not see.
  it('lists every package whose source tag is missing, and passes once it exists', async () => {
    const missing = await plan({ mode: 'preflight' }, 'failure');
    expect(missing.errors.join('\n')).toContain(`Missing source tags (1): ${missingTag}.`);

    await scratch.createTag(missingTag, fixture);

    const complete = await plan({ mode: 'preflight' });
    expect(complete.exitCode).toBe(0);
  });

  it('reports a commit that merges no release pull request', async () => {
    const result = await plan({ mode: 'plan' });

    expect(result.outputs).toMatchObject({ 'is-release': 'false', 'pull-request': '', releases: '[]' });
  });

  // Hostile inputs, run through the shipped bundle under the runner's contract. The API is
  // unreachable, so each case costs no request, and one made before the check would fail with a
  // different error than the one asserted.
  const prefixRule =
    "source-tag-prefix must be at most 100 letters, digits, '.', '_', '-' and '/', without '..' or '//'";
  it.each([
    ['an injection-style sha', { sha: '$(id)' }, 'sha must be a full lowercase commit id; got "$(id)".'],
    ['a Unicode prefix', { 'source-tag-prefix': 'src-ü-' }, `${prefixRule}; got "src-ü-".`],
    ['a traversal prefix', { 'source-tag-prefix': 'src/../' }, `${prefixRule}; got "src/../".`],
    [
      'an oversized prefix',
      { 'source-tag-prefix': `${'s'.repeat(101)}-` },
      `${prefixRule}; got ${JSON.stringify(`${'s'.repeat(101)}-`)}.`,
    ],
  ] as const)('refuses %s before calling the API', async (_name, inputs, message) => {
    const result = await plan({ mode: 'preflight', ...inputs }, 'failure', { GITHUB_API_URL: UNREACHABLE_API_URL });

    expect(result.errors).toEqual([message]);
  });

  it('fails on a commit that does not exist', async () => {
    const result = await plan({ mode: 'preflight', sha: '0'.repeat(40) }, 'failure');

    expect(result.errors.length).toBeGreaterThan(0);
  });
});
