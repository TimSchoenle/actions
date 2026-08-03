import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  expectCleanRejection,
  expectNoInjection,
  fileCommandInjectionPayload,
  INPUT_HOSTILE_CHARACTERS,
  LARGEST_DELIVERABLE_INPUT,
  oversized,
  runAction,
  TRAVERSAL_PATHS,
  Workspace,
  yamlAliasBomb,
} from 'actions-e2e';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ExpectedOutcome } from 'actions-e2e';

/**
 * Hostile cases for `actions/common/modify-yaml`.
 *
 * Two attack surfaces meet in this action, and they point in opposite directions. The `value` input
 * comes from the workflow and is written *into* repository content, so the question there is YAML
 * injection: can a value add a key, an anchor or a document rather than being one? The file it reads
 * is repository content, so `old-value` flows the other way — out of a pull request and into the log
 * and the outputs.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const FIXTURE_PATH = 'chart.yaml';

const FIXTURE = `# A chart
image:
  tag: v1.0.0 # pinned
  digest: sha256:abc
replicas: 2
`;

describe('modify-yaml under hostile input', () => {
  let workspace: Workspace;

  afterEach(async () => {
    await workspace.dispose();
  });

  async function modify(
    value: string,
    key = 'image.tag',
    expected: ExpectedOutcome = 'success',
    document = FIXTURE,
  ): ReturnType<typeof runAction<ActionInput, ActionOutput>> {
    workspace = await Workspace.create({ [FIXTURE_PATH]: document });

    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { file: FIXTURE_PATH, key, value },
      workspace,
      expect: expected,
    });
  }

  describe('YAML injection through the value', () => {
    // The property that makes this action safe to point at a chart: whatever the value looks like, it
    // is *one scalar*. If it were written as source text, a value could add a sibling key — and a
    // workflow that renders `value:` from a pull request title would be a chart-rewriting primitive.
    it.each([
      { name: 'a second key', value: 'v1.0.0\nreplicas: 999' },
      { name: 'a document separator', value: 'v1.0.0\n---\nreplicas: 999' },
      { name: 'an anchor definition', value: '&injected v1.0.0' },
      { name: 'an alias reference', value: '*injected' },
      { name: 'a merge key', value: '<<: {replicas: 999}' },
      { name: 'a tag directive', value: '!!str v1.0.0' },
      { name: 'a nested map', value: '{tag: v1, replicas: 999}' },
      { name: 'a comment that swallows the rest of the line', value: 'v1.0.0 # replicas: 999' },
    ])('writes $name as a scalar rather than as structure', async ({ value }) => {
      const result = await modify(value);

      const written = parse(await workspace.read(FIXTURE_PATH)) as Record<string, unknown>;

      expect(written['replicas'], 'no sibling key may change').toBe(2);
      expect((written['image'] as Record<string, unknown>)['tag']).toBe(value);
      expect(Object.keys(written).sort()).toEqual(['image', 'replicas']);
      expect(result.outputs['new-value']).toBe(value);
    });

    it('leaves the rest of the document byte-identical', async () => {
      await modify('v2.0.0');

      const written = await workspace.read(FIXTURE_PATH);

      expect(written.split('\n').filter((line) => !line.includes('tag:'))).toEqual(
        FIXTURE.split('\n').filter((line) => !line.includes('tag:')),
      );
    });
  });

  describe('workflow command injection', () => {
    it('forges nothing when the value it writes is a workflow command', async () => {
      const payload = commandInjectionPayload('v1.0.0');

      const result = await modify(payload);

      expect(result.outputs['new-value']).toBe(payload);
      expectNoInjection(result);
    });

    it('forges nothing when the value it replaced was a workflow command', async () => {
      const payload = commandInjectionPayload('v0.9.0');
      const document = `image:\n  tag: ${JSON.stringify(payload)}\n`;

      const result = await modify('v1.0.0', 'image.tag', 'success', document);

      expect(result.outputs['old-value'], 'the previous value is reported in full').toBe(payload);
      expectNoInjection(result);
    });

    it('forges nothing through a key or a path it could not use', async () => {
      workspace = await Workspace.create({ [FIXTURE_PATH]: FIXTURE });

      const result = await runAction<ActionInput, ActionOutput>({
        actionDirectory: ACTION_DIRECTORY,
        inputs: { file: FIXTURE_PATH, key: commandInjectionPayload('absent.key'), value: 'x' },
        workspace,
        expect: 'failure',
      });

      expectCleanRejection(result, /not found/);
      expectNoInjection(result);
      await expect(workspace.read(FIXTURE_PATH), 'a rejected change writes nothing').resolves.toBe(FIXTURE);
    });
  });

  describe('command file injection', () => {
    it('publishes exactly two outputs however the values are shaped', async () => {
      const payload = fileCommandInjectionPayload();

      const result = await modify(payload);

      expect(Object.keys(result.outputs).sort()).toEqual(['new-value', 'old-value']);
      expect(result.outputs['new-value']).toBe(payload);
      expectNoInjection(result);
    });
  });

  describe('hostile characters', () => {
    it.each(INPUT_HOSTILE_CHARACTERS)('writes $name ($risk) and reads it back unchanged', async ({ value }) => {
      const written = `v1${value}0`;

      const result = await modify(written);

      expect(result.outputs['new-value']).toBe(written);
      // Re-parsed rather than string-matched: the point is that the document is still valid YAML and
      // still holds exactly this scalar, whatever escaping the writer had to choose to get there.
      const document = parse(await workspace.read(FIXTURE_PATH)) as { image: { tag: string } };

      expect(document.image.tag).toBe(written);
      expectNoInjection(result);
    });
  });

  describe('documents and paths it must refuse', () => {
    // Not a rejection, and that is the interesting part: this action edits the document tree in place
    // and never materialises the values, so an alias bomb costs it nothing. The proof is that the
    // anchors are still anchors in the file it wrote — had it resolved them to write the document
    // back out, the result would be the multi-gigabyte expansion the bomb is built to produce.
    it('edits a document full of aliases without ever expanding them', async () => {
      const started = Date.now();

      const result = await modify('x', 'l8', 'success', yamlAliasBomb());
      const written = await workspace.read(FIXTURE_PATH);

      expect(result.outputs['new-value']).toBe('x');
      expect(written, 'the anchors must survive as anchors').toContain('&l0');
      expect(written.length, 'nothing may have expanded').toBeLessThan(4096);
      expect(Date.now() - started).toBeLessThan(30_000);
    }, 60_000);

    it.each(TRAVERSAL_PATHS)('fails legibly on $name and writes nothing', async ({ value }) => {
      workspace = await Workspace.create({ [FIXTURE_PATH]: FIXTURE });

      const result = await runAction<ActionInput, ActionOutput>({
        actionDirectory: ACTION_DIRECTORY,
        inputs: { file: value, key: 'image.tag', value: 'v9' },
        workspace,
        expect: 'failure',
      });

      expectCleanRejection(result);
      expectNoInjection(result);
      // The strong assertion: not "the fixture is unchanged" but "the workspace gained nothing".
      await expect(workspace.entries()).resolves.toEqual([FIXTURE_PATH]);
    });

    it('carries a value far larger than any real image tag', async () => {
      const payload = oversized(LARGEST_DELIVERABLE_INPUT);

      const result = await modify(payload);

      expect(result.outputs['new-value']).toHaveLength(payload.length);
      expect((parse(await workspace.read(FIXTURE_PATH)) as { image: { tag: string } }).image.tag).toHaveLength(
        payload.length,
      );
    });
  });
});
