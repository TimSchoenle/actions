import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';
import { TEST_PATHS } from './test-paths.js';

vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

beforeEach(() => {
  vi.stubEnv('INPUT_LANGUAGE', 'rust');
  vi.stubEnv('INPUT_EXCLUDE_TEST_PATHS', 'true');
  vi.stubEnv('INPUT_PATHS_IGNORE', '');
  vi.stubEnv('INPUT_CATEGORY', '');
  vi.stubEnv('INPUT_UPLOAD', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls.map(([name, value]) => [name, String(value)]));
}

function logged(): string {
  return vi
    .mocked(core.info)
    .mock.calls.map(([line]) => line)
    .join('\n');
}

describe('run', () => {
  it('publishes the configuration, the category and the upload mode', () => {
    vi.stubEnv('INPUT_PATHS_IGNORE', '# fixtures\nservices/api/test-support/**');

    run();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(outputs()).toMatchObject({ language: 'rust', category: '/language:rust', upload: 'always' });
    expect(JSON.parse(outputs()['config'] ?? '')).toMatchObject({
      'paths-ignore': [...TEST_PATHS, 'services/api/test-support/**'],
    });
  });

  it('logs every excluded pattern quoted, one per line', () => {
    vi.stubEnv('INPUT_EXCLUDE_TEST_PATHS', 'false');
    vi.stubEnv('INPUT_PATHS_IGNORE', 'vendor/**');

    run();

    expect(logged()).toContain('1 path pattern(s) excluded');
    expect(logged()).toContain('  "vendor/**"');
  });

  it('says so when nothing is excluded', () => {
    vi.stubEnv('INPUT_EXCLUDE_TEST_PATHS', 'false');

    run();

    expect(logged()).toContain('no path excluded');
    expect(JSON.parse(outputs()['config'] ?? '')).not.toHaveProperty('paths-ignore');
  });

  it('maps upload false to never', () => {
    vi.stubEnv('INPUT_UPLOAD', 'false');

    run();

    expect(outputs()['upload']).toBe('never');
  });

  it('fails the step and publishes nothing on an unusable input', () => {
    vi.stubEnv('INPUT_PATHS_IGNORE', '!keep/**');

    run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('paths-ignore'));
    expect(core.setOutput).not.toHaveBeenCalled();
  });
});
