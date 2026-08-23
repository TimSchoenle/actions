import { describe, expect, it } from 'vitest';

import { ManifestFieldMissingError, ManifestParseError } from '../errors.js';
import { readChartManifest } from './chart.js';

describe('readChartManifest', () => {
  it('reads the chart version as the release, and appVersion as compatibility', () => {
    const facts = readChartManifest(
      `name: portfolio
description: Personal portfolio built with Rust.
version: 5.1.4
appVersion: v2.7.1
kubeVersion: ">=1.28.0-0"
home: https://github.com/TimSchoenle/helm-charts
`,
      'Chart.yaml',
    );

    expect(facts).toEqual({
      kind: 'chart',
      name: 'portfolio',
      version: '5.1.4',
      description: 'Personal portfolio built with Rust.',
      homepage: 'https://github.com/TimSchoenle/helm-charts',
      toolchain: { appVersion: 'v2.7.1', kubeVersion: '>=1.28.0-0' },
    });
  });

  // An unquoted `1.2` is a YAML float, and a chart that forgets the quotes still has a version.
  it('coerces an unquoted numeric version to a string', () => {
    const facts = readChartManifest(`name: c\nversion: 1.2\nappVersion: 3\n`, 'Chart.yaml');

    expect(facts.version).toBe('1.2');
    expect(facts.toolchain).toEqual({ appVersion: '3' });
  });

  it('omits an absent appVersion rather than emitting it empty', () => {
    expect(readChartManifest(`name: c\nversion: "1.0.0"\n`, 'Chart.yaml').toolchain).toEqual({});
  });

  it('refuses a file that is not YAML', () => {
    expect(() => readChartManifest('a:\n  - b\n c: broken\n', 'Chart.yaml')).toThrow(ManifestParseError);
  });

  it.each([
    ['a sequence', '- one\n- two\n'],
    ['a bare scalar', 'just a string\n'],
  ])('refuses %s at the top level', (_label, source) => {
    expect(() => readChartManifest(source, 'Chart.yaml')).toThrow(/the top level is not a YAML mapping/);
  });

  it('reports a missing version', () => {
    expect(() => readChartManifest(`name: c\n`, 'charts/x/Chart.yaml')).toThrow(ManifestFieldMissingError);
  });
});
