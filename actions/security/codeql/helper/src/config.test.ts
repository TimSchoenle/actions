import { describe, expect, it } from 'vitest';

import { buildConfig, excludedPaths, renderConfig } from './config.js';
import { parsePattern } from './options.js';
import { TEST_PATHS } from './test-paths.js';

import type { AnalysisOptions } from './options.js';

function options(overrides: Partial<AnalysisOptions> = {}): AnalysisOptions {
  return {
    language: 'rust',
    excludeTestPaths: true,
    pathsIgnore: [],
    category: '/language:rust',
    upload: true,
    ...overrides,
  };
}

describe('TEST_PATHS', () => {
  // The shared list goes through the same rules as a caller's, so it cannot hold a pattern
  // CodeQL would match literally.
  it.each(TEST_PATHS)('holds a pattern CodeQL reads as a glob: %s', (pattern) => {
    expect(parsePattern(pattern)).toBe(pattern);
  });

  it('holds no duplicate', () => {
    expect(new Set(TEST_PATHS).size).toBe(TEST_PATHS.length);
  });
});

describe('excludedPaths', () => {
  it('puts the test paths first and appends the caller patterns', () => {
    expect(excludedPaths(options({ pathsIgnore: ['services/api/test-support/**'] }))).toEqual([
      ...TEST_PATHS,
      'services/api/test-support/**',
    ]);
  });

  it('keeps a caller pattern the shared list already holds once', () => {
    expect(excludedPaths(options({ pathsIgnore: ['**/tests/**'] }))).toEqual([...TEST_PATHS]);
  });

  it('excludes only the caller patterns when the test paths are off', () => {
    expect(excludedPaths(options({ excludeTestPaths: false, pathsIgnore: ['vendor/**'] }))).toEqual(['vendor/**']);
  });
});

describe('buildConfig', () => {
  it('leaves paths-ignore out when nothing is excluded', () => {
    expect(buildConfig(options({ excludeTestPaths: false }))).not.toHaveProperty('paths-ignore');
  });

  it('carries every excluded pattern', () => {
    expect(buildConfig(options())['paths-ignore']).toEqual(TEST_PATHS);
  });
});

describe('renderConfig', () => {
  it('writes one line that reads back to the same configuration', () => {
    const config = buildConfig(options({ pathsIgnore: ['odd "quoted" dir/**'] }));
    const rendered = renderConfig(config);

    expect(rendered).not.toContain('\n');
    expect(JSON.parse(rendered)).toEqual(config);
  });
});
