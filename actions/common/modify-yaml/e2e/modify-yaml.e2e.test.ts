import { fileURLToPath } from 'node:url';

import { runAction, Workspace } from 'actions-e2e';
import { afterEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';

/**
 * End-to-end cases for `actions/common/modify-yaml`, replacing the thirteen-way matrix of
 * `verify-action-common-modify-yaml.yaml`.
 *
 * The shell version asserted with `grep`, which can only say that the new value appears *somewhere*.
 * These cases diff the whole document instead, so a modification that also disturbs a comment, a
 * blank line or an unrelated key fails — which is the property the action exists to guarantee and
 * the one `grep` structurally could not check.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const FIXTURE = `# Top-level comment with special chars: @#$%
version: 1.0.0

# Application Metadata
app:
  name: test-app # inline comment
  debug: true
  enabled: false  # another inline comment

  # Database Configuration
  database:
    primary:
      host: localhost
      port: 5432  # default postgres port
      credentials:
        username: admin
        password: secret123
        # Nested config
        options:
          timeout: 30
          retry: 3

    # Secondary database
    secondary:
      host: backup-db
      port: 5433

  # Resource limits
  resources:
    cpu_ratio: 1.0
    memory: 512Mi  # with unit

# Keys with similar names
api:
  endpoint: https://api.example.com
  api_key: secret
  api_version: v2

# Varied indentation (weird but valid)
config:
    deeply:   # 6 spaces indent
        nested:  # 10 spaces
            value: test
            another: data
`;

const FIXTURE_PATH = 'complex.yaml';

/** The lines that differ between two documents, as `-old` / `+new` pairs. */
function changedLines(before: string, after: string): string[] {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const changes: string[] = [];

  expect(afterLines.length, 'the document gained or lost lines').toBe(beforeLines.length);

  for (const [index, line] of beforeLines.entries()) {
    if (line !== afterLines[index]) {
      changes.push(`-${line}`, `+${afterLines[index]}`);
    }
  }

  return changes;
}

describe('modify-yaml', () => {
  let workspace: Workspace | undefined;

  afterEach(async () => {
    await workspace?.dispose();
    workspace = undefined;
  });

  async function modify(
    key: string,
    value: string,
  ): Promise<{ outputs: Partial<Record<ActionOutput, string>>; changes: string[] }> {
    workspace = await Workspace.create({ [FIXTURE_PATH]: FIXTURE });

    const result = await runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { file: FIXTURE_PATH, key, value },
      workspace,
    });

    return { outputs: result.outputs, changes: changedLines(FIXTURE, await workspace.read(FIXTURE_PATH)) };
  }

  it.each([
    { name: 'a root key', key: 'version', value: '2.0.0', was: '1.0.0', line: 'version: 2.0.0' },
    {
      name: 'a key three levels down',
      key: 'app.database.primary.host',
      value: 'db.internal',
      was: 'localhost',
      line: '      host: db.internal',
    },
    { name: 'a true boolean to false', key: 'app.debug', value: 'false', was: 'true', line: '  debug: false' },
    {
      name: 'a false boolean to true',
      key: 'app.enabled',
      value: 'true',
      was: 'false',
      line: '  enabled: true  # another inline comment',
    },
    {
      name: 'an integer',
      key: 'app.database.primary.port',
      value: '3306',
      was: '5432',
      line: '      port: 3306  # default postgres port',
    },
    // `old-value` is `1`, not `1.0`: YAML types `1.0` as a number, and the action reports the parsed
    // value rather than the source text. The shell version never inspected `old-value` at all.
    { name: 'a float', key: 'app.resources.cpu_ratio', value: '2.5', was: '1', line: '    cpu_ratio: 2.5' },
    {
      name: 'a value carrying a unit',
      key: 'app.resources.memory',
      value: '1024Mi',
      was: '512Mi',
      line: '    memory: 1024Mi  # with unit',
    },
    {
      name: 'a key five levels down',
      key: 'app.database.primary.credentials.options.timeout',
      value: '60',
      was: '30',
      line: '          timeout: 60',
    },
    {
      name: 'a key under unusual indentation',
      key: 'config.deeply.nested.value',
      value: 'modified',
      was: 'test',
      line: '            value: modified',
    },
    {
      name: 'the right one of several similarly named keys',
      key: 'api.api_key',
      value: 'new-secret',
      was: 'secret',
      line: '  api_key: new-secret',
    },
  ])('modifies $name', async ({ key, value, was, line }) => {
    const { outputs, changes } = await modify(key, value);

    expect(outputs).toEqual({ 'old-value': was, 'new-value': value });
    expect(changes).toEqual([expect.any(String), `+${line}`]);
  });

  it('preserves an inline comment on the line it rewrites', async () => {
    const { changes } = await modify('app.name', 'updated-app');

    expect(changes).toEqual(['-  name: test-app # inline comment', '+  name: updated-app # inline comment']);
  });

  // The case the matrix flagged CRITICAL: `secondary.host` shares a key name with `primary.host`.
  // Asserting on the whole document proves it untouched without a second `verify_unchanged` pattern.
  it('modifies only the addressed key when a sibling shares its name', async () => {
    const { changes } = await modify('app.database.primary.host', 'primary-changed');

    expect(changes).toEqual(['-      host: localhost', '+      host: primary-changed']);
  });

  it('fails when the key does not exist', async () => {
    workspace = await Workspace.create({ [FIXTURE_PATH]: FIXTURE });

    const result = await runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { file: FIXTURE_PATH, key: 'app.database.absent', value: 'x' },
      workspace,
      expect: 'failure',
    });

    expect(result.errors.join('\n')).toContain('app.database.absent');
    await expect(workspace.read(FIXTURE_PATH)).resolves.toBe(FIXTURE);
  });
});
