import { fileURLToPath } from 'node:url';

import { runAction } from 'actions-e2e';
import { describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';

/**
 * End-to-end cases for `actions/terrace/setup`: the committed bundle, run the way the runner runs it.
 *
 * Every case here is refused before the first download, so none needs the network or a token. The
 * installs themselves, which reach GitHub releases and the Sigstore trust root on each runner
 * operating system, are the extra jobs in `extra-jobs.yaml`.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const DEFAULTS = {
  version: '',
  working_directory: '.',
  oras: 'false',
  cosign_version: 'v3.1.3',
  oras_version: '1.3.4',
  github_token: '',
} as const;

describe('terrace setup', () => {
  async function refused(
    inputs: Partial<Record<ActionInput, string>>,
    files: Record<string, string> = {},
  ): Promise<Awaited<ReturnType<typeof runAction<ActionInput, ActionOutput>>>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { ...DEFAULTS, ...inputs },
      files,
      expect: 'failure',
    });
  }

  it.each([
    {
      description: 'a version that is not MAJOR.MINOR[.PATCH]',
      inputs: { version: 'latest' },
      reason: /version: must be/,
    },
    {
      description: 'an oras flag that is not a boolean',
      inputs: { version: '0.8.0', oras: 'yes' },
      reason: /oras: must be true or false/,
    },
    {
      description: 'a working_directory outside the workspace',
      inputs: { working_directory: '../up' },
      reason: /must not traverse upwards/,
    },
    { description: 'no version and no terrace.yaml', inputs: {}, reason: /cannot be read/ },
  ])('refuses $description', async ({ inputs, reason }) => {
    const result = await refused(inputs);

    expect(result.errors.join('\n')).toMatch(reason);
    expect(result.addedPath).toEqual([]);
    expect(result.outputs).toEqual({});
  });

  it.each([
    { description: 'an unquoted cli pin', text: 'version: 1\ncli: 0.10\n', reason: /quoted/ },
    { description: 'a terrace.yaml with no cli pin', text: 'version: 1\n', reason: /declares no cli pin/ },
    { description: 'a layer version it does not read', text: 'version: 2\ncli: "0.8"\n', reason: /declares version 2/ },
  ])('refuses $description, naming the file', async ({ text, reason }) => {
    const result = await refused({ working_directory: 'service' }, { 'service/terrace.yaml': text });
    const errors = result.errors.join('\n');

    expect(errors).toMatch(reason);
    expect(errors).toContain('terrace.yaml');
    expect(result.addedPath).toEqual([]);
  });
});
