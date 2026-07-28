import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './action.js';
import { OutputDriftError } from './errors.js';
import { generateFile } from './generate.js';

/**
 * Only the reporting side of `@actions/core` is mocked. Input reading stays real so that the tests
 * exercise the actual `getInput`/`getBooleanInput` semantics — including the `required` check and
 * the boolean parsing — instead of a hand-written stand-in.
 */
vi.mock('@actions/core', async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

vi.mock('./generate.js');

type Inputs = Record<string, string>;

const defaultInputs: Inputs = {
  template: 'README.hbs',
  output: 'README.md',
  variables: '{"title":"Actions"}',
  'partials-dir': '',
  strict: 'true',
  'escape-html': 'false',
  check: 'false',
};

/** Publishes the inputs the way the Actions runner does: as `INPUT_*` environment variables. */
function setInputs(overrides: Inputs = {}): void {
  for (const [name, value] of Object.entries({ ...defaultInputs, ...overrides })) {
    vi.stubEnv(`INPUT_${name.toUpperCase()}`, value);
  }
}

function outputs(): Record<string, string> {
  return Object.fromEntries(vi.mocked(core.setOutput).mock.calls as [string, string][]);
}

function logged(): string {
  return vi
    .mocked(core.info)
    .mock.calls.map(([message]) => message)
    .join('\n');
}

describe('render-template action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInputs();
    vi.mocked(generateFile).mockResolvedValue({ changed: true, checksum: 'abc123', partialCount: 0 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes every input through to the generator', async () => {
    setInputs({ 'partials-dir': 'docs/partials', 'escape-html': 'true', strict: 'false' });

    await run();

    expect(generateFile).toHaveBeenCalledWith({
      templatePath: 'README.hbs',
      outputPath: 'README.md',
      variables: '{"title":"Actions"}',
      partialsDir: 'docs/partials',
      strict: false,
      escapeHtml: true,
      check: false,
    });
  });

  it('publishes every output', async () => {
    await run();

    expect(outputs()).toEqual({ changed: 'true', checksum: 'abc123', 'output-path': 'README.md' });
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('publishes changed as false when the file was already current', async () => {
    vi.mocked(generateFile).mockResolvedValue({ changed: false, checksum: 'abc123', partialCount: 0 });

    await run();

    expect(outputs()).toMatchObject({ changed: 'false' });
  });

  it.each(['template', 'output'])('fails when the required input %s is empty', async (name) => {
    setInputs({ [name]: '' });

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining(name));
    expect(generateFile).not.toHaveBeenCalled();
  });

  it('defaults the optional inputs the way action.yaml declares them', async () => {
    // The runner supplies declared defaults; an absent variable here stands for a caller who set
    // nothing, which `getInput` reports as an empty string.
    vi.unstubAllEnvs();
    setInputs({ variables: '', 'partials-dir': '', strict: 'false', 'escape-html': 'false', check: 'false' });

    await run();

    expect(generateFile).toHaveBeenCalledWith(expect.objectContaining({ variables: '', partialsDir: '' }));
  });

  describe('check mode', () => {
    it('forwards the check flag', async () => {
      setInputs({ check: 'true' });
      vi.mocked(generateFile).mockResolvedValue({ changed: false, checksum: 'abc123', partialCount: 0 });

      await run();

      expect(generateFile).toHaveBeenCalledWith(expect.objectContaining({ check: true }));
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it('fails the step with the drift detail when the output is stale', async () => {
      setInputs({ check: 'true' });
      vi.mocked(generateFile).mockRejectedValue(new OutputDriftError('README.md', 'First difference on line 2:'));

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('README.md: is out of date.'));
      expect(core.setOutput).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('says it is rendering in write mode and checking in check mode', async () => {
      await run();
      expect(logged()).toContain('Rendering README.md from README.hbs');

      vi.clearAllMocks();
      setInputs({ check: 'true' });
      vi.mocked(generateFile).mockResolvedValue({ changed: false, checksum: 'abc', partialCount: 0 });

      await run();
      expect(logged()).toContain('Checking README.md from README.hbs');
    });

    // A mis-pointed partials directory otherwise fails much later, with a message about a template.
    it('reports the partial count when there were any', async () => {
      vi.mocked(generateFile).mockResolvedValue({ changed: true, checksum: 'abc', partialCount: 3 });

      await run();

      expect(logged()).toContain('Registered 3 partial(s)');
    });

    it('stays quiet about partials when there were none', async () => {
      await run();

      expect(logged()).not.toContain('partial(s)');
    });

    it('distinguishes a write from a no-op', async () => {
      await run();
      expect(logged()).toContain('Wrote README.md');

      vi.clearAllMocks();
      setInputs();
      vi.mocked(generateFile).mockResolvedValue({ changed: false, checksum: 'abc', partialCount: 0 });

      await run();
      expect(logged()).toContain('left untouched');
    });
  });

  it('fails the step with the message of whatever the generator threw', async () => {
    vi.mocked(generateFile).mockRejectedValue(new Error('README.hbs: template file not found or not readable.'));

    await run();

    expect(core.setFailed).toHaveBeenCalledWith('README.hbs: template file not found or not readable.');
    expect(core.setOutput).not.toHaveBeenCalled();
  });
});
