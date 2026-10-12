import { describe, expect, it } from 'vitest';

import { InvalidInputError } from './errors.js';
import {
  parseBoolean,
  parseChoice,
  parseImage,
  parseInputLines,
  PERSONAS,
  resolveScanOptions,
  zizmorArguments,
} from './options.js';

import type { RawScanInputs } from './options.js';

const IMAGE = `ghcr.io/zizmorcore/zizmor:1.30.1@sha256:${'a'.repeat(64)}`;

const DEFAULTS: RawScanInputs = {
  inputs: '.',
  persona: 'pedantic',
  onlineAudits: 'true',
  minSeverity: '',
  minConfidence: '',
  config: '',
  failOnSeverity: 'informational',
  strictCollection: 'true',
  upload: 'true',
  token: 'ghs_token',
  image: IMAGE,
};

function rejection(action: () => unknown): InvalidInputError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidInputError);

    return error as InvalidInputError;
  }

  throw new Error('expected an InvalidInputError');
}

describe('parseInputLines', () => {
  it('keeps one path per line, trimmed, skipping blanks, comments and carriage returns', () => {
    expect(parseInputLines('.\r\n\r\n# the custom workflows\r\n  workflows/release/workflow.yaml  \n')).toEqual([
      '.',
      'workflows/release/workflow.yaml',
    ]);
  });

  it('keeps a duplicate once, at its first position', () => {
    expect(parseInputLines('a\nb\na')).toEqual(['a', 'b']);
  });

  it.each(['-', '--version', '-o', '--config=/etc/passwd', '  --fix=all'])(
    'refuses %j, which zizmor would read as a flag',
    (line) => {
      const error = rejection(() => parseInputLines(`.\n${line}`));

      expect(error.input).toBe('inputs');
      expect(error.message).toContain('./-name');
    },
  );

  it('accepts a path that begins with a dash once it is written relative', () => {
    expect(parseInputLines('./-weird')).toEqual(['./-weird']);
  });

  it.each(['', '\n\n', '# only a comment'])('refuses %j, which names no path', (value) => {
    expect(rejection(() => parseInputLines(value)).message).toContain('names no path');
  });
});

describe('parseChoice', () => {
  it('accepts the value as zizmor spells it', () => {
    expect(parseChoice('persona', ' auditor ', PERSONAS)).toBe('auditor');
  });

  it.each(['Pedantic', 'strict', ''])('refuses %j and lists every valid value', (value) => {
    expect(rejection(() => parseChoice('persona', value, PERSONAS)).message).toContain('regular, pedantic, auditor');
  });
});

describe('parseBoolean', () => {
  it.each([
    ['TRUE', true],
    ['False', false],
  ])('reads %j as %j', (value, expected) => {
    expect(parseBoolean('upload', value)).toBe(expected);
  });

  it.each(['yes', '1', ''])('refuses %j', (value) => {
    expect(rejection(() => parseBoolean('upload', value)).input).toBe('upload');
  });
});

describe('parseImage', () => {
  it('accepts a reference pinned by digest, with or without a tag', () => {
    expect(parseImage(IMAGE)).toBe(IMAGE);
    expect(parseImage(`ghcr.io/zizmorcore/zizmor@sha256:${'b'.repeat(64)}`)).toContain('@sha256:');
  });

  it.each([
    'ghcr.io/zizmorcore/zizmor:1.30.1',
    'ghcr.io/zizmorcore/zizmor:latest',
    `--privileged@sha256:${'a'.repeat(64)}`,
    `ghcr.io/zizmorcore/zizmor@sha256:${'a'.repeat(63)}`,
  ])('refuses %j', (value) => {
    expect(rejection(() => parseImage(value)).input).toBe('image');
  });
});

describe('resolveScanOptions', () => {
  it('resolves the defaults the composite passes', () => {
    expect(resolveScanOptions(DEFAULTS)).toEqual({
      inputs: ['.'],
      persona: 'pedantic',
      onlineAudits: true,
      minSeverity: undefined,
      minConfidence: undefined,
      config: undefined,
      failOnSeverity: 'informational',
      strictCollection: true,
      upload: true,
      token: 'ghs_token',
      image: IMAGE,
    });
  });

  it('drops the token when online audits are off, so the container never receives it', () => {
    expect(resolveScanOptions({ ...DEFAULTS, onlineAudits: 'false' }).token).toBeUndefined();
  });

  it('refuses an empty token with online audits on, which zizmor would answer by skipping them', () => {
    expect(rejection(() => resolveScanOptions({ ...DEFAULTS, token: ' ' })).input).toBe('token');
  });

  it('accepts an empty token with online audits off', () => {
    expect(resolveScanOptions({ ...DEFAULTS, token: '', onlineAudits: 'false' }).onlineAudits).toBe(false);
  });

  it.each([
    ['minSeverity', 'min-severity', 'critical'],
    ['minConfidence', 'min-confidence', 'informational'],
    ['failOnSeverity', 'fail-on-severity', 'High'],
    ['strictCollection', 'strict-collection', 'on'],
  ] as const)('refuses an invalid %s under its composite name', (key, input, value) => {
    expect(rejection(() => resolveScanOptions({ ...DEFAULTS, [key]: value })).input).toBe(input);
  });

  it('accepts none as fail-on-severity', () => {
    expect(resolveScanOptions({ ...DEFAULTS, failOnSeverity: 'none' }).failOnSeverity).toBe('none');
  });
});

describe('zizmorArguments', () => {
  it('passes the defaults, then the paths after --', () => {
    expect(zizmorArguments(resolveScanOptions(DEFAULTS), ['.'], undefined)).toEqual([
      '--persona=pedantic',
      '--format=sarif',
      '--color=never',
      '--cache-dir=/tmp/zizmor',
      '--strict-collection',
      '--',
      '.',
    ]);
  });

  it('passes every optional setting as one --name=value argument', () => {
    const options = resolveScanOptions({
      ...DEFAULTS,
      onlineAudits: 'false',
      strictCollection: 'false',
      minSeverity: 'low',
      minConfidence: 'high',
      persona: 'auditor',
    });

    expect(zizmorArguments(options, ['.', 'workflows/a.yaml'], '.github/zizmor.yml')).toEqual([
      '--persona=auditor',
      '--format=sarif',
      '--color=never',
      '--cache-dir=/tmp/zizmor',
      '--no-online-audits',
      '--min-severity=low',
      '--min-confidence=high',
      '--config=.github/zizmor.yml',
      '--',
      '.',
      'workflows/a.yaml',
    ]);
  });
});
