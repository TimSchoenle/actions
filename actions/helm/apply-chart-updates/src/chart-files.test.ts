import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MissingChartVersionError, readChartVersion, resolveChartFiles, UnsafePathError } from './chart-files.js';

const WORKSPACE = resolve('/workspace');

describe('resolveChartFiles', () => {
  it('resolves both files beneath the chart path', () => {
    const { chartFile, valuesFile } = resolveChartFiles('charts/tankovault', WORKSPACE);

    expect(chartFile).toBe(resolve(WORKSPACE, 'charts/tankovault/Chart.yaml'));
    expect(valuesFile).toBe(resolve(WORKSPACE, 'charts/tankovault/values.yaml'));
  });

  it('reports POSIX-separated repository-relative paths for the commit pattern', () => {
    expect(resolveChartFiles('infra/k8s/charts/nested', WORKSPACE).relativePaths).toEqual([
      'infra/k8s/charts/nested/Chart.yaml',
      'infra/k8s/charts/nested/values.yaml',
    ]);
  });

  it('supports a chart at the repository root', () => {
    expect(resolveChartFiles('.', WORKSPACE).relativePaths).toEqual(['Chart.yaml', 'values.yaml']);
  });

  it.each([
    ['empty', '  '],
    ['a POSIX absolute path', '/etc/charts'],
    ['a Windows absolute path', 'C:/charts'],
    ['an upward traversal', '../../charts/app'],
    ['a traversal in the middle', 'charts/../../app'],
    ['a backslash traversal', 'charts\\..\\..\\app'],
  ])('rejects %s', (_label, chartPath) => {
    expect(() => resolveChartFiles(chartPath, WORKSPACE)).toThrow(UnsafePathError);
  });
});

describe('readChartVersion', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'chart-files-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function chartWith(body: string): Promise<string> {
    const file = join(directory, 'Chart.yaml');
    await writeFile(file, body, 'utf8');

    return file;
  }

  it('reads a quoted version', async () => {
    expect(await readChartVersion(await chartWith('name: app\nversion: "1.2.3"\n'))).toBe('1.2.3');
  });

  it('reads a version the parser typed as a number', async () => {
    expect(await readChartVersion(await chartWith('version: 1\n'))).toBe('1');
  });

  it('fails when there is no version to bump', async () => {
    await expect(readChartVersion(await chartWith('name: app\n'))).rejects.toThrow(MissingChartVersionError);
  });
});
