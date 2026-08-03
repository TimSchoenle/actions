import { fileURLToPath } from 'node:url';

import { runAction } from 'actions-e2e';
import { describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';

/**
 * End-to-end cases for `actions/common/read-yaml`, replacing the five-way matrix of
 * `verify-action-common-read-yaml.yaml`.
 *
 * This action reaches nothing but the filesystem, so its cases need no token and no scratch
 * repository — they are the fastest proof that the harness reproduces the runner's input and output
 * contract.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const FIXTURE = `version: 1.0.0
# Application Metadata
app:
  name: test-app # inline comment
  debug: true
  # Database Configuration
  database:
    host: localhost
    port: 5432
  resources:
    limits:
      cpu: 500m
`;

describe('read-yaml', () => {
  function read(key: string, expected: 'success' | 'failure' = 'success'): ReturnType<typeof runAction> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { file: 'complex.yaml', key },
      files: { 'complex.yaml': FIXTURE },
      expect: expected,
    });
  }

  it.each([
    { description: 'a root key', key: 'version', expected: '1.0.0' },
    { description: 'a nested key', key: 'app.name', expected: 'test-app' },
    { description: 'a deeply nested key', key: 'app.database.host', expected: 'localhost' },
    { description: 'a value carrying a unit', key: 'app.resources.limits.cpu', expected: '500m' },
    { description: 'a boolean, as the string the runner delivers', key: 'app.debug', expected: 'true' },
  ])('reads $description', async ({ key, expected }) => {
    const result = await read(key);

    expect(result.outputs).toEqual({ value: expected });
  });

  // The matrix could only assert on keys that resolve; a key that does not was never covered.
  it('fails when the key does not exist', async () => {
    const result = await read('app.database.missing', 'failure');

    expect(result.errors.join('\n')).toContain('app.database.missing');
  });

  it('fails when the file does not exist', async () => {
    const result = await runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { file: 'absent.yaml', key: 'version' },
      expect: 'failure',
    });

    expect(result.errors.join('\n')).toContain('absent.yaml');
  });
});
