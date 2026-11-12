import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

import { MissingKeysError, NonScalarTargetError, planYamlEdits, writeEditPlan } from './edits.js';

/** Mirrors the shape that matters in a real chart: nested services, annotations, mixed quoting. */
const VALUES = `# yaml-language-server: $schema=values.schema.json
services:
  api:
    # @schema
    # type: string
    # @schema
    # -- Image tag, pinned by digest.
    image:
      repository: owner/api
      tag: v0.1.0@sha256:aaa   # trailing comment
  worker:
    image:
      repository: owner/worker
      tag: "v0.1.0@sha256:bbb"
bootstrap:
  image:
    tag: v0.1.0@sha256:ccc
postgresql:
  image:
    tag: 18-alpine@sha256:ddd
`;

describe('planYamlEdits', () => {
  let directory: string;
  let file: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'apply-chart-edits-'));
    file = join(directory, 'values.yaml');
    await writeFile(file, VALUES, 'utf8');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('writes every key in one pass', async () => {
    const plan = await planYamlEdits(file, [
      { key: 'services.api.image.tag', value: 'v1.0.0@sha256:111' },
      { key: 'services.worker.image.tag', value: 'v0.9.4@sha256:222' },
      { key: 'bootstrap.image.tag', value: 'v1.0.0@sha256:333' },
    ]);

    await writeEditPlan(plan);
    const written = await readFile(file, 'utf8');

    expect(written).toContain('tag: v1.0.0@sha256:111');
    expect(written).toContain('tag: v0.9.4@sha256:222');
    expect(written).toContain('tag: v1.0.0@sha256:333');
  });

  // The reason this action splices rather than re-serializes: a chart's `# @schema` annotations are
  // load-bearing, and the third-party images it does not manage must not move.
  it('leaves every other byte untouched', async () => {
    const plan = await planYamlEdits(file, [{ key: 'services.api.image.tag', value: 'v1.0.0@sha256:111' }]);
    await writeEditPlan(plan);

    const written = await readFile(file, 'utf8');

    expect(written).toBe(VALUES.replace('v0.1.0@sha256:aaa', 'v1.0.0@sha256:111'));
    expect(written).toContain('# -- Image tag, pinned by digest.');
    expect(written).toContain('tag: 18-alpine@sha256:ddd');
  });

  it('reports the previous value of each key, in caller order', async () => {
    const plan = await planYamlEdits(file, [
      { key: 'bootstrap.image.tag', value: 'v1.0.0@sha256:333' },
      { key: 'services.api.image.tag', value: 'v1.0.0@sha256:111' },
    ]);

    expect(plan.applied).toEqual([
      { key: 'bootstrap.image.tag', old: 'v0.1.0@sha256:ccc', new: 'v1.0.0@sha256:333' },
      { key: 'services.api.image.tag', old: 'v0.1.0@sha256:aaa', new: 'v1.0.0@sha256:111' },
    ]);
  });

  // Planning is separate from writing so that a bad key cannot leave a half-updated chart behind.
  it('does not touch the file while planning', async () => {
    await planYamlEdits(file, [{ key: 'services.api.image.tag', value: 'v1.0.0@sha256:111' }]);

    expect(await readFile(file, 'utf8')).toBe(VALUES);
  });

  it('lists every missing key at once rather than one per run', async () => {
    const failure = planYamlEdits(file, [
      { key: 'services.api.image.tag', value: 'v1' },
      { key: 'services.absent.image.tag', value: 'v1' },
      { key: 'services.gone.image.tag', value: 'v1' },
    ]);

    await expect(failure).rejects.toThrow(MissingKeysError);
    await expect(failure).rejects.toThrow(/services\.absent\.image\.tag, services\.gone\.image\.tag/);
  });

  it('refuses a key that addresses a map rather than a value', async () => {
    await expect(planYamlEdits(file, [{ key: 'services.api.image', value: 'v1' }])).rejects.toThrow(
      NonScalarTargetError,
    );
  });

  // Chart versions and image tags are strings; typing them from their text would turn `18` into a
  // number and change what the chart means.
  it('always writes a string', async () => {
    const chart = join(directory, 'Chart.yaml');
    await writeFile(chart, 'version: 1.2.3\nappVersion: "v0.0.1"\n', 'utf8');

    await writeEditPlan(
      await planYamlEdits(chart, [
        { key: 'version', value: '1.2.4' },
        { key: 'appVersion', value: '18' },
      ]),
    );

    expect(await readFile(chart, 'utf8')).toBe('version: 1.2.4\nappVersion: "18"\n');
  });

  // Each case below was a reproduced corruption: the splice wrote text that parsed differently, or
  // not at all, and nothing checked it.
  describe('splices that used to change the meaning of the file', () => {
    async function edited(yaml: string, key: string, value: string): Promise<unknown> {
      await writeFile(file, yaml, 'utf8');
      const document = parseDocument((await planYamlEdits(file, [{ key, value }])).content);
      expect(document.errors).toEqual([]);

      return document.toJS();
    }

    it('writes a tag into an empty node instead of replacing its map', async () => {
      expect(await edited('image:\n  tag:\n  repository: x\n', 'image.tag', 'v2')).toEqual({
        image: { tag: 'v2', repository: 'x' },
      });
    });

    it('keeps a tag with a comma one entry of a flow map', async () => {
      expect(await edited('image: { tag: v1, repository: x }\n', 'image.tag', 'v2,extra')).toEqual({
        image: { tag: 'v2,extra', repository: 'x' },
      });
    });

    it('keeps the key after a block scalar it replaces', async () => {
      expect(await edited('tag: |\n  v1\nnext: 2\n', 'tag', 'v2')).toEqual({ tag: 'v2', next: 2 });
    });

    it('keeps a long value on its own line, under its key', async () => {
      const long = Array.from({ length: 30 }, (_, index) => `w${index}`).join(' ');

      expect(await edited('a:\n  b:\n    tag: v1\n  c: 1\n', 'a.b.tag', long)).toEqual({
        a: { b: { tag: long }, c: 1 },
      });
    });
  });

  it('fails on a file that is not there', async () => {
    await expect(planYamlEdits(join(directory, 'nope.yaml'), [{ key: 'a', value: 'b' }])).rejects.toThrow();
  });
});
