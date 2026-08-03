import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  DECEPTIVE_PATHS,
  expectCleanRejection,
  expectNoInjection,
  fileCommandInjectionPayload,
  LARGEST_DELIVERABLE_INPUT,
  oversized,
  REDOS_PATTERNS,
  runAction,
  TRAVERSAL_PATHS,
  Workspace,
} from 'actions-e2e';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * Hostile cases for `actions/helm/apply-chart-updates`.
 *
 * This action rewrites a chart in a repository it is handed a write token for, so every one of its
 * guards is load-bearing: `chart-path` decides *which* files it opens, `key-pattern` decides which
 * keys of `values.yaml` it may touch, `value-pattern` decides what it may write there, and the
 * changelog it emits is pasted verbatim into a pull request body. The previous values it reports come
 * out of the chart, which on a `pull_request` run is content the pull request author wrote.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const CHART_PATH = 'charts/app';
const DIGEST = `sha256:${'a'.repeat(64)}`;

const CHART = 'apiVersion: v2\nname: app\nversion: 1.0.0\nappVersion: "v0.1.0"\n';

const VALUES = `services:
  api:
    image:
      repository: owner/api
      tag: v0.1.0@sha256:old   # pinned
secrets:
  token: do-not-touch
`;

function chartFiles(values = VALUES): Record<string, string> {
  return { [`${CHART_PATH}/Chart.yaml`]: CHART, [`${CHART_PATH}/values.yaml`]: values };
}

describe('apply-chart-updates under hostile input', () => {
  let workspace: Workspace;

  afterEach(async () => {
    await workspace.dispose();
  });

  async function apply(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
    values = VALUES,
  ): ReturnType<typeof runAction<ActionInput, ActionOutput>> {
    workspace = await Workspace.create(chartFiles(values));

    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: {
        'chart-path': CHART_PATH,
        images: JSON.stringify({ 'services.api.image.tag': { tag: 'v0.2.0', digest: DIGEST } }),
        ...inputs,
      },
      workspace,
      expect: expected,
    });
  }

  describe('chart-path containment', () => {
    it.each(TRAVERSAL_PATHS)('refuses $name and rewrites nothing', async ({ value }) => {
      const result = await apply({ 'chart-path': value }, 'failure');

      expectCleanRejection(result, /chart-path/);
      expect(result.outputs, 'a rejected run publishes nothing at all').toEqual({});
      await expect(workspace.entries()).resolves.toEqual([`${CHART_PATH}/Chart.yaml`, `${CHART_PATH}/values.yaml`]);
    });

    it.each(DECEPTIVE_PATHS)('reports $name as a chart it cannot find, not as an escape', async ({ value }) => {
      const result = await apply({ 'chart-path': value }, 'failure');

      // Contained, therefore simply absent — the distinction matters because a workflow author
      // debugging a typo needs "no chart there", not "you tried to escape the workspace".
      expectCleanRejection(result);
      expect(result.errors.join('\n')).not.toMatch(/must not traverse/);
    });

    // Refused one step earlier than the containment check, by `@actions/core`, which treats an empty
    // required input as an absent one. Asserted anyway: what matters is that no run ever reaches
    // `resolve(workspace, '')` and quietly adopts the repository root as the chart directory.
    it.each([
      { name: 'an empty chart-path', value: '' },
      { name: 'a whitespace-only chart-path', value: '   ' },
    ])('refuses $name rather than treating it as the repository root', async ({ value }) => {
      const result = await apply({ 'chart-path': value }, 'failure');

      expectCleanRejection(result, /chart-path/);
      expect(result.outputs).toEqual({});
    });
  });

  describe('what it is allowed to write', () => {
    it.each([
      { name: 'a key outside the image-tag shape', key: 'secrets.token' },
      { name: 'a key reaching a prototype', key: '__proto__.polluted' },
      { name: 'a key with a traversal in it', key: '../../etc.image.tag' },
      { name: 'a key that is a workflow command', key: '::error::image.tag' },
    ])('refuses $name', async ({ key }) => {
      const result = await apply({ images: JSON.stringify({ [key]: { tag: 'v0.2.0', digest: DIGEST } }) }, 'failure');

      expectCleanRejection(result);
      expectNoInjection(result);
      await expect(workspace.read(`${CHART_PATH}/values.yaml`), 'the chart is untouched').resolves.toBe(VALUES);
    });

    it.each([
      { name: 'a shell metacharacter', tag: 'v1.0.0; rm -rf /' },
      { name: 'a newline', tag: 'v1.0.0\nreplicas: 999' },
      { name: 'a workflow command', tag: '::error::forged' },
      { name: 'a YAML anchor', tag: '&anchor' },
      { name: 'a value far past any tag length', tag: 'v'.repeat(300) },
      { name: 'a path traversal', tag: '../../../etc/passwd' },
    ])('refuses to write $name as an image tag', async ({ tag }) => {
      const result = await apply(
        { images: JSON.stringify({ 'services.api.image.tag': { tag, digest: DIGEST } }) },
        'failure',
      );

      // `value-pattern` is the last line of defence before repository content is rewritten, and it is
      // the reason none of these ever reach `values.yaml`.
      expectCleanRejection(result);
      expectNoInjection(result);
      await expect(workspace.read(`${CHART_PATH}/values.yaml`)).resolves.toBe(VALUES);
    });

    it('refuses a chart-version that is not SemVer, without logging it as a command', async () => {
      const result = await apply({ 'chart-version': commandInjectionPayload('9.9.9') }, 'failure');

      expectCleanRejection(result);
      expectNoInjection(result);
    });
  });

  describe('workflow command injection out of the chart', () => {
    // The previous tag is chart content, so a pull request can put anything in it. The action logs
    // every edit as `key: old -> new`, which is where an unescaped old value would have landed.
    it('reports a previous value that forges commands without any of them taking effect', async () => {
      const payload = commandInjectionPayload('v0.0.1');
      const values = `services:\n  api:\n    image:\n      tag: ${JSON.stringify(payload)}\n`;

      const result = await apply({}, 'success', values);

      expect(JSON.parse(result.outputs['changes'] ?? '[]')).toEqual([
        { key: 'services.api.image.tag', old: payload, new: `v0.2.0@${DIGEST}` },
      ]);
      expectNoInjection(result);
    });

    it('publishes a summary table that cannot break out of its own cells', async () => {
      const values = `services:\n  api:\n    image:\n      tag: ${JSON.stringify('v0|0\n| evil | row |')}\n`;

      const result = await apply({}, 'success', values);
      const summary = result.outputs['summary-markdown'] ?? '';

      expect(summary, 'a raw pipe would add a column').not.toMatch(/\|\s*evil\s*\|/);
      expectNoInjection(result);
    });
  });

  describe('the changelog it hands to a pull request body', () => {
    it('neutralizes mentions and issue-closing keywords', async () => {
      const changelog = ['- @octocat rewrote it', '- Fixes #12', '- Closes https://github.com/o/r/issues/9'].join('\n');

      const result = await apply({ changelog });
      const markdown = result.outputs['changelog-markdown'] ?? '';

      expect(markdown, 'no live mention may survive').not.toMatch(/(^|[^\w`&])@octocat/m);
      expect(markdown, 'no live closing keyword may survive').not.toMatch(/\bFixes #12/);
      expect(markdown, 'no live closing keyword may survive').not.toMatch(/\bCloses https/);
      expect(markdown).toContain('octocat');
    });

    it('truncates a changelog that would overflow a pull request body', async () => {
      const result = await apply({ changelog: oversized(LARGEST_DELIVERABLE_INPUT), 'changelog-max-bytes': '2000' });
      const markdown = result.outputs['changelog-markdown'] ?? '';

      expect(new TextEncoder().encode(markdown).length).toBeLessThan(3000);
      expect(markdown).toContain('truncated');
    });

    it('forges nothing through a changelog full of workflow commands', async () => {
      const result = await apply({ changelog: commandInjectionPayload('## Release') });

      expectNoInjection(result);
    });

    it.each(['0', '-1', 'nine', '1e9', '1.5'])('refuses the byte cap %s', async (cap) => {
      const result = await apply({ 'changelog-max-bytes': cap }, 'failure');

      expectCleanRejection(result, /changelog-max-bytes/);
    });

    // An omitted optional input and an empty one are the same thing to the runner, so an empty cap
    // has to mean "use the default" — failing on it would make the input impossible to leave unset.
    it('falls back to the default cap when the input is empty', async () => {
      const result = await apply({ 'changelog-max-bytes': '   ', changelog: '- a release' });

      expect(result.outputs['changelog-markdown']).toContain('a release');
    });
  });

  describe('patterns supplied as inputs', () => {
    it.each(REDOS_PATTERNS)(
      'does not hang on $name as a key-pattern',
      async ({ pattern, subject }) => {
        const started = Date.now();

        // The subject is fed in as the key, so the pattern is matched against exactly what makes it
        // backtrack. A run that has not returned in a minute is the denial of service, not a slow test.
        const result = await apply(
          { 'key-pattern': pattern, images: JSON.stringify({ [subject]: { tag: 'v1', digest: DIGEST } }) },
          'any',
        );

        expect(Date.now() - started, 'must not backtrack for minutes on a billed runner').toBeLessThan(60_000);
        expect(result.exitCode, 'the key does not exist, so this can only fail').not.toBe(0);
      },
      120_000,
    );

    it.each([
      { name: 'an unterminated group', pattern: '^(unclosed' },
      { name: 'an invalid escape class', pattern: '[z-a]' },
      { name: 'a lone quantifier', pattern: '*' },
    ])('refuses $name as a pattern with a message naming the input', async ({ pattern }) => {
      const result = await apply({ 'value-pattern': pattern }, 'failure');

      expectCleanRejection(result, /value-pattern/);
    });
  });

  describe('malformed inputs', () => {
    it.each([
      { name: 'images that are not JSON', images: 'services.api.image.tag: v1' },
      { name: 'images that are an array', images: '["services.api.image.tag"]' },
      { name: 'images that are empty', images: '{}' },
      { name: 'an entry that is not an object', images: '{"services.api.image.tag":"v1"}' },
      { name: 'an entry reaching a prototype', images: '{"__proto__":{"tag":"v1"}}' },
    ])('refuses $name', async ({ images }) => {
      const result = await apply({ images }, 'failure');

      expectCleanRejection(result);
      await expect(workspace.read(`${CHART_PATH}/values.yaml`)).resolves.toBe(VALUES);
    });

    it('refuses a values file whose addressed key is missing, leaving both files alone', async () => {
      const result = await apply({}, 'failure', 'services: {}\n');

      expectCleanRejection(result);
      await expect(workspace.read(`${CHART_PATH}/Chart.yaml`), 'the version must not be bumped').resolves.toBe(CHART);
    });

    it('publishes exactly its declared outputs and forges no extra key', async () => {
      const result = await apply({ changelog: fileCommandInjectionPayload() });

      expect(Object.keys(result.outputs).sort()).toEqual([
        'changelog-markdown',
        'changes',
        'chart-version',
        'files',
        'previous-chart-version',
        'summary-markdown',
        'updated-count',
      ]);
      expect(result.exportedEnv).toEqual({});
      expectNoInjection(result);
    });

    it('leaves the chart parseable after every accepted write', async () => {
      await apply({});

      const values = parse(await workspace.read(`${CHART_PATH}/values.yaml`)) as {
        services: { api: { image: { tag: string } } };
        secrets: { token: string };
      };

      expect(values.services.api.image.tag).toBe(`v0.2.0@${DIGEST}`);
      expect(values.secrets.token, 'an unaddressed key must never move').toBe('do-not-touch');
    });
  });
});
