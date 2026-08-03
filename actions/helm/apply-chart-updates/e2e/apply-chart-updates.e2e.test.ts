import { fileURLToPath } from 'node:url';

import { runAction, Workspace } from 'actions-e2e';
import { afterEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/helm/apply-chart-updates`, replacing the three jobs of
 * `verify-action-helm-apply-chart-updates.yaml` — including its eight-way rejection matrix, which
 * alone cost eight runner slots.
 *
 * The action only touches the filesystem, so these cases need no token and no scratch repository.
 *
 * Three assertions are stronger here than the shell version could make them:
 *
 * - The multi-image case diffs the *whole* `values.yaml` line by line and pins every changed line.
 *   The workflow counted `diff | grep -c '^> '` lines, which cannot tell four rewritten tags from
 *   one rewritten tag plus three lost comments, and its follow-up greps only spot-checked the
 *   survivors it happened to name.
 * - Outputs are compared as one object, so an output the action stops publishing — or starts
 *   publishing — fails the case. The workflow read six named outputs and could not see a seventh.
 * - Each rejection also asserts that *nothing* was published, not merely that the files are
 *   unchanged: a half-completed run that still wrote outputs would have passed the workflow.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

/** Distinct per image, so a digest copied from the wrong entry is visible rather than plausible. */
const DIGEST_API = `sha256:${'1'.repeat(64)}`;
const DIGEST_WORKER = `sha256:${'2'.repeat(64)}`;
const DIGEST_RENDER = `sha256:${'3'.repeat(64)}`;
const DIGEST_BOOTSTRAP = `sha256:${'4'.repeat(64)}`;

const MULTI_PATH = 'charts/multi';
const MULTI_CHART = `apiVersion: v2
name: multi
description: A chart with independently released services
version: 1.2.3
appVersion: "v0.4.1"
`;

/**
 * Shaped like a real multi-service chart: schema annotations, a doc comment, a trailing comment, a
 * quoted value, a top-level image outside `services`, and third-party images this chart does not
 * release. Every one of those is something a naive rewrite loses.
 */
const MULTI_VALUES = `# yaml-language-server: $schema=values.schema.json
services:
  api:
    # @schema
    # type: string
    # @schema
    # -- Image tag, pinned by digest.
    image:
      repository: owner/api
      tag: v0.4.1@sha256:aaa   # trailing comment
  worker:
    image:
      repository: owner/worker
      tag: "v0.4.1@sha256:bbb"
  render:
    image:
      repository: owner/render
      tag: v0.4.1@sha256:ccc
bootstrap:
  image:
    tag: v0.4.1@sha256:ddd
# Third-party images this chart does not release and must never rewrite.
postgresql:
  image:
    tag: 18-alpine@sha256:eee
valkey:
  image:
    tag: 9.1.1-alpine@sha256:fff
`;

const REJECT_PATH = 'charts/reject';
const REJECT_CHART = 'apiVersion: v2\nname: reject\nversion: 1.0.0\nappVersion: "v0.0.1"\n';
const REJECT_VALUES =
  'services:\n  api:\n    image:\n      tag: v0.0.1@sha256:aaa\n  worker:\n    image:\n      tag: v0.0.1@sha256:bbb\n';

const LOG_PATH = 'charts/log';

/** Inputs the action must reject, each of which must also leave the chart exactly as it found it. */
const REJECTION_CASES = [
  { name: 'a key outside the allowlist', images: '{"allowUnsafeExposure": {"tag": "v1.0.0"}}' },
  { name: 'a key absent from the chart', images: '{"services.absent.image.tag": {"tag": "v1.0.0"}}' },
  { name: 'a key traversing the prototype chain', images: '{"services.__proto__.image.tag": {"tag": "v1.0.0"}}' },
  { name: 'a value the value pattern rejects', images: '{"services.api.image.tag": {"tag": ".hidden"}}' },
  {
    name: 'an undefined placeholder',
    images: '{"services.api.image.tag": {"tag": "v1.0.0"}}',
    template: '${tag}@${digest}',
  },
  // One entry short a tag must fail, never inherit its sibling's version.
  {
    name: 'one entry missing its own tag',
    images: '{"services.api.image.tag": {"tag": "v1.0.0"}, "services.worker.image.tag": {}}',
  },
  { name: 'a variable value carrying a newline', images: '{"services.api.image.tag": {"tag": "v1\\nrm -rf /"}}' },
  { name: 'images that is not an object', images: '[]' },
];

/** Stands in for a line one revision has and the other does not, so a length change cannot hide. */
const ABSENT_LINE = '<no such line>';

interface LineChange {
  readonly line: number;
  readonly from: string;
  readonly to: string;
}

/** Every line that differs between two revisions of a file, paired by position. */
function lineChanges(before: string, after: string): LineChange[] {
  const from = before.split('\n');
  const to = after.split('\n');
  const changes: LineChange[] = [];

  for (let index = 0; index < Math.max(from.length, to.length); index++) {
    if (from[index] !== to[index]) {
      changes.push({ line: index + 1, from: from[index] ?? ABSENT_LINE, to: to[index] ?? ABSENT_LINE });
    }
  }

  return changes;
}

/** Padding long enough that the byte cap lands mid-document, which is what makes truncation observable. */
function padding(character: string): string {
  return `- Padding to force truncation: ${character.repeat(50)}`;
}

const CHANGELOG_MAX_BYTES = 400;

/** The `<details>` wrapper the action adds; the cap applies to the sanitized text, not to this. */
const CHANGELOG_WRAPPER_BYTES = 52;

const HOSTILE_CHANGELOG = [
  "## What's changed",
  '',
  '- Rework the worker, thanks @octocat and @acme/platform',
  '- Fixes #12',
  '- Closes https://github.com/TimSchoenle/helm-charts/issues/13',
  padding('a'),
  padding('b'),
  padding('c'),
  padding('d'),
  padding('e'),
  '',
].join('\n');

/** An `@` that would still notify: not already broken into an entity, and not inside a code span. */
const ACTIVE_MENTION = /(^|[^\w`])@[A-Za-z\d]/;

/** A keyword GitHub acts on, closing the referenced issue when the pull request merges. */
const CLOSING_REFERENCE = /(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(#\d|https?:\/\/)/i;

describe('apply-chart-updates', () => {
  let workspace: Workspace;

  afterEach(async () => {
    await workspace.dispose();
  });

  function apply(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs,
      workspace,
      expect: expected,
    });
  }

  it('gives every image its own version and digest without moving anything else', async () => {
    workspace = await Workspace.create({
      [`${MULTI_PATH}/Chart.yaml`]: MULTI_CHART,
      [`${MULTI_PATH}/values.yaml`]: MULTI_VALUES,
    });

    const result = await apply({
      'chart-path': MULTI_PATH,
      images: JSON.stringify({
        'services.api.image.tag': { tag: 'v1.0.0', digest: DIGEST_API },
        'services.worker.image.tag': { tag: 'v0.9.4', digest: DIGEST_WORKER },
        'services.render.image.tag': { tag: 'v2.1.0', digest: DIGEST_RENDER },
        'bootstrap.image.tag': { tag: 'v1.0.0', digest: DIGEST_BOOTSTRAP },
      }),
    });

    // Pinning the changed lines by position asserts the untouched ones too: the schema annotations,
    // the doc comment, the trailing comment and both third-party images are all lines that must not
    // appear here, and the line numbers hold only if nothing was inserted or removed.
    expect(lineChanges(MULTI_VALUES, await workspace.read(`${MULTI_PATH}/values.yaml`))).toEqual([
      {
        line: 10,
        from: '      tag: v0.4.1@sha256:aaa   # trailing comment',
        to: `      tag: v1.0.0@${DIGEST_API}   # trailing comment`,
      },
      // The splice replaces the scalar token including its quotes, so a quoted value comes back
      // plain. That is a rewrite of the same value, not a lost one.
      { line: 14, from: '      tag: "v0.4.1@sha256:bbb"', to: `      tag: v0.9.4@${DIGEST_WORKER}` },
      { line: 18, from: '      tag: v0.4.1@sha256:ccc', to: `      tag: v2.1.0@${DIGEST_RENDER}` },
      { line: 21, from: '    tag: v0.4.1@sha256:ddd', to: `    tag: v1.0.0@${DIGEST_BOOTSTRAP}` },
    ]);

    // No app-version was given: a chart whose services release independently has none, so the bump
    // must reach `version` and nothing else.
    await expect(workspace.read(`${MULTI_PATH}/Chart.yaml`)).resolves.toBe(
      MULTI_CHART.replace('version: 1.2.3', 'version: 1.2.4'),
    );

    expect(result.outputs).toEqual({
      'chart-version': '1.2.4',
      'previous-chart-version': '1.2.3',
      'updated-count': '4',
      changes: JSON.stringify([
        { key: 'services.api.image.tag', old: 'v0.4.1@sha256:aaa', new: `v1.0.0@${DIGEST_API}` },
        { key: 'services.worker.image.tag', old: 'v0.4.1@sha256:bbb', new: `v0.9.4@${DIGEST_WORKER}` },
        { key: 'services.render.image.tag', old: 'v0.4.1@sha256:ccc', new: `v2.1.0@${DIGEST_RENDER}` },
        { key: 'bootstrap.image.tag', old: 'v0.4.1@sha256:ddd', new: `v1.0.0@${DIGEST_BOOTSTRAP}` },
      ]),
      'summary-markdown': [
        '| Key | From | To |',
        '| --- | --- | --- |',
        `| \`services.api.image.tag\` | \`v0.4.1@sha256:aaa\` | \`v1.0.0@${DIGEST_API}\` |`,
        `| \`services.worker.image.tag\` | \`v0.4.1@sha256:bbb\` | \`v0.9.4@${DIGEST_WORKER}\` |`,
        `| \`services.render.image.tag\` | \`v0.4.1@sha256:ccc\` | \`v2.1.0@${DIGEST_RENDER}\` |`,
        `| \`bootstrap.image.tag\` | \`v0.4.1@sha256:ddd\` | \`v1.0.0@${DIGEST_BOOTSTRAP}\` |`,
      ].join('\n'),
      // Empty rather than absent, so a composite can embed it unconditionally without leaving an
      // empty heading behind.
      'changelog-markdown': '',
      files: `${MULTI_PATH}/Chart.yaml ${MULTI_PATH}/values.yaml`,
    });
  });

  it.each(REJECTION_CASES)('rejects $name without touching the chart', async ({ images, template }) => {
    workspace = await Workspace.create({
      [`${REJECT_PATH}/Chart.yaml`]: REJECT_CHART,
      [`${REJECT_PATH}/values.yaml`]: REJECT_VALUES,
    });

    const result = await apply(
      { 'chart-path': REJECT_PATH, images, ...(template === undefined ? {} : { 'value-template': template }) },
      'failure',
    );

    // Both files are planned before either is written, so a rejection anywhere leaves both alone —
    // a bumped Chart.yaml beside an unchanged values.yaml would be a chart claiming a release it
    // never made.
    await expect(workspace.read(`${REJECT_PATH}/Chart.yaml`)).resolves.toBe(REJECT_CHART);
    await expect(workspace.read(`${REJECT_PATH}/values.yaml`)).resolves.toBe(REJECT_VALUES);
    expect(result.outputs).toEqual({});
  });

  it('publishes a changelog that cannot notify anyone or close anything', async () => {
    workspace = await Workspace.create({
      [`${LOG_PATH}/Chart.yaml`]: 'apiVersion: v2\nname: log\nversion: 1.0.0\n',
      [`${LOG_PATH}/values.yaml`]: 'image:\n  tag: v0.0.1@sha256:aaa\n',
    });

    const result = await apply({
      'chart-path': LOG_PATH,
      images: `{"image.tag": {"tag": "v1.0.0", "digest": "${DIGEST_API}"}}`,
      'changelog-max-bytes': String(CHANGELOG_MAX_BYTES),
      changelog: HOSTILE_CHANGELOG,
    });

    const changelog = result.outputs['changelog-markdown'] ?? '';

    // Both mentions and both closing keywords are broken in the source while still rendering as the
    // characters they replaced, and the padding is cut at a line boundary so the Markdown stays
    // well-formed.
    expect(changelog).toBe(
      [
        '<details>',
        '<summary>Changelog</summary>',
        '',
        "## What's changed",
        '',
        '- Rework the worker, thanks &#64;octocat and &#64;acme/platform',
        '- &#70;ixes #12',
        '- &#67;loses https://github.com/TimSchoenle/helm-charts/issues/13',
        padding('a'),
        padding('b'),
        '',
        '_… changelog truncated_',
        '',
        '</details>',
      ].join('\n'),
    );

    // Stated as properties as well as bytes: the bytes pin this fixture, the properties are what the
    // sanitizer owes every changelog it is ever given.
    expect(changelog).not.toMatch(ACTIVE_MENTION);
    expect(changelog).not.toMatch(CLOSING_REFERENCE);
    expect(new TextEncoder().encode(changelog).length).toBeLessThanOrEqual(
      CHANGELOG_MAX_BYTES + CHANGELOG_WRAPPER_BYTES,
    );
  });
});
