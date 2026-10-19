import { describe, expect, it } from 'vitest';

import { InvalidInputError } from './errors.js';
import { readCliPin } from './repo-config.js';

const FILE = '/work/terrace.yaml';

describe('readCliPin', () => {
  it('reads a MAJOR.MINOR pin', () => {
    expect(readCliPin('version: 1\ncli: "0.8"\nhelm:\n  charts: charts\n', FILE)).toEqual({ major: 0, minor: 8 });
  });

  it('reads an exact pin', () => {
    expect(readCliPin("version: 1\ncli: '0.8.1'\n", FILE)).toEqual({ major: 0, minor: 8, patch: 1 });
  });

  it('leaves keys it does not read to the CLI', () => {
    expect(readCliPin('version: 1\ncli: "0.8"\nx-team: platform\nfuture: true\n', FILE)).toEqual({
      major: 0,
      minor: 8,
    });
  });

  it.each([
    ['an unquoted pin, which YAML reads as a float', 'version: 1\ncli: 0.10\n', /quoted/],
    ['a pin with a leading v', 'version: 1\ncli: "v0.8"\n', /quoted/],
    ['no pin', 'version: 1\nhelm: {}\n', /declares no cli pin/],
    ['an unsupported layer version', 'version: 2\ncli: "0.8"\n', /declares version 2/],
    ['a missing layer version', 'cli: "0.8"\n', /declares version undefined/],
    ['a list at the top level', '- cli\n', /mapping/],
    ['invalid YAML', 'version: [1\n', /not valid YAML/],
    ['a duplicated key', 'version: 1\ncli: "0.8"\ncli: "0.9"\n', /not valid YAML/],
  ])('refuses %s, naming the file', (_, text, reason) => {
    const failure = (): unknown => readCliPin(text, FILE);

    expect(failure).toThrow(InvalidInputError);
    expect(failure).toThrow(reason);
    expect(failure).toThrow(FILE);
  });
});
