import { fileURLToPath } from 'node:url';

import { runAction } from 'actions-e2e';
import { describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../helper/src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/security/codeql`.
 *
 * `codeql-action/init` and `analyze` are the runner's to run, and `extra-jobs.yaml` runs them for
 * real over a fixture crate. These cases drive the shipped helper bundle with the `INPUT_*` names the
 * composite passes, and assert on the configuration and category it hands those two steps.
 */

const HELPER_DIRECTORY = fileURLToPath(new URL('../helper', import.meta.url));

function prepare(
  inputs: ProvidedInputs<ActionInput>,
  expected: ExpectedOutcome = 'success',
): Promise<ActionRunResult<ActionOutput>> {
  return runAction<ActionInput, ActionOutput>({
    actionDirectory: HELPER_DIRECTORY,
    inputs: { language: 'rust', ...inputs },
    expect: expected,
  });
}

function pathsIgnore(result: ActionRunResult<ActionOutput>): unknown {
  return (JSON.parse(result.outputs['config'] ?? '{}') as Record<string, unknown>)['paths-ignore'];
}

describe('security/codeql', () => {
  it('excludes the shared test paths and records under the category default setup writes', async () => {
    const result = await prepare({});

    expect(result.outputs).toMatchObject({ language: 'rust', category: '/language:rust', upload: 'always' });
    expect(pathsIgnore(result)).toEqual(expect.arrayContaining(['**/tests/**', '**/*_tests.rs', '**/src/test/**']));
  });

  it('appends the caller patterns, skipping comments, blank lines and carriage returns', async () => {
    const result = await prepare({
      paths_ignore: '# Fixtures hold fake keys by design.\r\nservices/api/test-support/**\r\n\r\n',
    });

    expect(pathsIgnore(result)).toEqual(expect.arrayContaining(['services/api/test-support/**']));
    expect(pathsIgnore(result)).not.toEqual(expect.arrayContaining([expect.stringContaining('#')]));
  });

  it('writes no paths-ignore at all with the test paths off and no pattern given', async () => {
    const result = await prepare({ exclude_test_paths: 'false' });

    expect(pathsIgnore(result)).toBeUndefined();
  });

  it('hands analyze never when upload is false', async () => {
    const result = await prepare({ upload: 'false' });

    expect(result.outputs['upload']).toBe('never');
  });

  it('refuses a negated pattern, which CodeQL would match literally', async () => {
    const result = await prepare({ paths_ignore: '!src/keep.rs' }, 'failure');

    expect(result.errors.join('\n')).toContain('paths-ignore');
    expect(result.outputs['config']).toBeUndefined();
  });

  it('refuses a language alias and names the identifier default setup categorises by', async () => {
    const result = await prepare({ language: 'typescript' }, 'failure');

    expect(result.errors.join('\n')).toContain('"javascript-typescript"');
  });

  it('refuses a language that needs a build', async () => {
    const result = await prepare({ language: 'go' }, 'failure');

    expect(result.errors.join('\n')).toContain('has no build-mode none');
  });
});
