import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyUpdate, planImageEdits } from './update.js';
import { InvalidInputError, parseImages, parseVariables } from './inputs.js';
import { TemplateError } from './template.js';

import type { UpdateRequest } from './update.js';

const CHART = 'apiVersion: v2\nname: tankovault\nversion: 1.2.3\nappVersion: "v0.4.1"\n';

const VALUES = `services:
  api:
    image:
      tag: v0.4.1@sha256:aaa
  worker:
    image:
      tag: v0.4.1@sha256:bbb
  render:
    image:
      tag: v0.4.1@sha256:ccc
bootstrap:
  image:
    tag: v0.4.1@sha256:ddd
postgresql:
  image:
    tag: 18-alpine@sha256:eee
`;

const KEY_PATTERN = /^([A-Za-z0-9_-]+\.)*image\.tag$/;
const VALUE_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}(@sha256:[0-9a-f]{64})?$/;

function digest(seed: string): string {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

describe('planImageEdits', () => {
  function request(overrides: Partial<UpdateRequest>): UpdateRequest {
    return {
      chartFile: 'Chart.yaml',
      valuesFile: 'values.yaml',
      images: [],
      sharedVariables: new Map(),
      valueTemplate: '${tag}@${digest}',
      keyPattern: KEY_PATTERN,
      valuePattern: VALUE_PATTERN,
      chartVersion: '1.2.4',
      previousChartVersion: '1.2.3',
      appVersion: undefined,
      ...overrides,
    };
  }

  // Services released independently drift apart; nothing in the action may assume otherwise.
  it('gives each image its own version', () => {
    const edits = planImageEdits(
      request({
        images: parseImages(
          JSON.stringify({
            'services.api.image.tag': { tag: 'v1.0.0', digest: digest('1') },
            'services.worker.image.tag': { tag: 'v0.9.4', digest: digest('2') },
          }),
        ),
      }),
    );

    expect(edits).toEqual([
      { key: 'services.api.image.tag', value: `v1.0.0@${digest('1')}` },
      { key: 'services.worker.image.tag', value: `v0.9.4@${digest('2')}` },
    ]);
  });

  // The single-image chart layout the action's predecessor supported: `image.tag` at the top level,
  // with nothing in front of it. The default key allowlist has to keep accepting it.
  it('accepts a top-level image.tag', () => {
    const edits = planImageEdits(
      request({ images: parseImages(JSON.stringify({ 'image.tag': { tag: 'v1.0.0', digest: digest('1') } })) }),
    );

    expect(edits).toEqual([{ key: 'image.tag', value: `v1.0.0@${digest('1')}` }]);
  });

  it('lets an entry override a shared default', () => {
    const edits = planImageEdits(
      request({
        sharedVariables: parseVariables(JSON.stringify({ tag: 'v1.0.0', digest: digest('1') })),
        images: parseImages(JSON.stringify({ 'services.render.image.tag': { tag: 'v2.1.0' } })),
      }),
    );

    expect(edits[0].value).toBe(`v2.1.0@${digest('1')}`);
  });

  it('fails rather than inheriting a sibling version when an entry is short a variable', () => {
    const build = (): unknown =>
      planImageEdits(
        request({
          images: parseImages(
            JSON.stringify({
              'services.api.image.tag': { tag: 'v1.0.0', digest: digest('1') },
              'services.worker.image.tag': { digest: digest('2') },
            }),
          ),
        }),
      );

    expect(build).toThrow(TemplateError);
    expect(build).toThrow(/services\.worker\.image\.tag/);
  });

  it('rejects a key outside the allowlist', () => {
    const build = (): unknown =>
      planImageEdits(request({ images: parseImages(JSON.stringify({ allowUnsafeExposure: { tag: 'v1' } })) }));

    expect(build).toThrow(InvalidInputError);
    expect(build).toThrow(/images key/);
  });

  it('rejects a rendered value the value pattern does not accept', () => {
    const build = (): unknown =>
      planImageEdits(
        request({
          valueTemplate: '${tag}',
          images: parseImages(JSON.stringify({ 'image.tag': { tag: '.hidden' } })),
        }),
      );

    expect(build).toThrow(/rendered value for 'image\.tag'/);
  });
});

describe('applyUpdate', () => {
  let directory: string;
  let chartFile: string;
  let valuesFile: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'apply-chart-update-'));
    chartFile = join(directory, 'Chart.yaml');
    valuesFile = join(directory, 'values.yaml');
    await writeFile(chartFile, CHART, 'utf8');
    await writeFile(valuesFile, VALUES, 'utf8');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function request(overrides: Partial<UpdateRequest> = {}): UpdateRequest {
    return {
      chartFile,
      valuesFile,
      images: parseImages(
        JSON.stringify({
          'services.api.image.tag': { tag: 'v1.0.0', digest: digest('1') },
          'services.worker.image.tag': { tag: 'v0.9.4', digest: digest('2') },
          'bootstrap.image.tag': { tag: 'v1.0.0', digest: digest('3') },
        }),
      ),
      sharedVariables: new Map(),
      valueTemplate: '${tag}@${digest}',
      keyPattern: KEY_PATTERN,
      valuePattern: VALUE_PATTERN,
      chartVersion: '1.2.4',
      previousChartVersion: '1.2.3',
      appVersion: undefined,
      ...overrides,
    };
  }

  it('updates every managed image and the chart version', async () => {
    const { imageEdits, chartEdits } = await applyUpdate(request());

    expect(imageEdits).toHaveLength(3);
    expect(chartEdits).toEqual([{ key: 'version', old: '1.2.3', new: '1.2.4' }]);

    const values = await readFile(valuesFile, 'utf8');
    expect(values).toContain(`tag: v1.0.0@${digest('1')}`);
    expect(values).toContain(`tag: v0.9.4@${digest('2')}`);
    expect(await readFile(chartFile, 'utf8')).toContain('version: 1.2.4');
  });

  it('leaves images it was not asked about alone', async () => {
    await applyUpdate(request());

    expect(await readFile(valuesFile, 'utf8')).toContain('tag: 18-alpine@sha256:eee');
  });

  // A chart whose services release independently has no single app version to write.
  it('leaves appVersion untouched when none was given', async () => {
    await applyUpdate(request());

    expect(await readFile(chartFile, 'utf8')).toContain('appVersion: "v0.4.1"');
  });

  it('writes appVersion when the caller supplies one', async () => {
    const { chartEdits } = await applyUpdate(request({ appVersion: 'v1.0.0' }));

    expect(chartEdits).toHaveLength(2);
    expect(await readFile(chartFile, 'utf8')).toContain('appVersion: v1.0.0');
  });

  // The atomicity guarantee: one bad key means an untouched checkout, not a bumped chart pointing at
  // images that were never written.
  it('leaves both files byte-identical when any key is wrong', async () => {
    const failure = applyUpdate(
      request({
        images: parseImages(
          JSON.stringify({
            'services.api.image.tag': { tag: 'v1.0.0', digest: digest('1') },
            'services.absent.image.tag': { tag: 'v1.0.0', digest: digest('2') },
          }),
        ),
      }),
    );

    await expect(failure).rejects.toThrow(/services\.absent\.image\.tag/);
    expect(await readFile(valuesFile, 'utf8')).toBe(VALUES);
    expect(await readFile(chartFile, 'utf8')).toBe(CHART);
  });

  it('leaves both files byte-identical when the chart has no version to bump', async () => {
    await writeFile(chartFile, 'name: app\n', 'utf8');

    await expect(applyUpdate(request({ chartVersion: '1.0.0' }))).rejects.toThrow(/version/);
    expect(await readFile(valuesFile, 'utf8')).toBe(VALUES);
  });
});
