import { describe, expect, it } from 'vitest';

import { parseActionManifest } from '../manifest.js';

const FILE = 'actions/x/y/action.yaml';

describe('parseActionManifest', () => {
  it('reads name, description, runtime, inputs and outputs in written order', () => {
    const manifest = parseActionManifest(
      `
name: 'X Y'
description: 'Does a thing.'
inputs:
  zeta:
    description: 'Last alphabetically, first in the file.'
    required: true
  alpha:
    description: 'Has a default.'
    default: \${{ github.token }}
  flag:
    required: 'true'
    default: false
outputs:
  result:
    description: 'The result.'
runs:
  using: 'node24'
  main: 'dist/index.js'
`,
      FILE,
    );

    expect(manifest).toEqual({
      name: 'X Y',
      description: 'Does a thing.',
      runtime: 'node24',
      inputs: [
        { name: 'zeta', description: 'Last alphabetically, first in the file.', required: true, default: undefined },
        { name: 'alpha', description: 'Has a default.', required: false, default: '${{ github.token }}' },
        // GitHub hands a YAML boolean default to the action as the string 'false'.
        { name: 'flag', description: '', required: true, default: 'false' },
      ],
      outputs: [{ name: 'result', description: 'The result.' }],
    });
  });

  it('treats a missing inputs or outputs map as none', () => {
    const manifest = parseActionManifest('name: n\nruns:\n  using: composite\n  steps: []\n', FILE);
    expect(manifest.inputs).toEqual([]);
    expect(manifest.outputs).toEqual([]);
    expect(manifest.description).toBe('');
  });

  it('accepts an input declared with no body', () => {
    const manifest = parseActionManifest('name: n\ninputs:\n  bare:\nruns:\n  using: composite\n', FILE);
    expect(manifest.inputs).toEqual([{ name: 'bare', description: '', required: false, default: undefined }]);
  });

  it.each([
    ['not a map', '- a\n- b\n', /expected a YAML map/],
    ['no name', 'runs:\n  using: composite\n', /'name' is missing/],
    ['no runtime', 'name: n\n', /'runs.using' is missing/],
    ['inputs as a list', 'name: n\ninputs: [a]\nruns:\n  using: composite\n', /'inputs' must be a map/],
    ['an input as a scalar', 'name: n\ninputs:\n  a: x\nruns:\n  using: composite\n', /inputs\.a must be a map/],
  ])('refuses %s', (_case, content, message) => {
    expect(() => parseActionManifest(content, FILE)).toThrow(message);
  });
});
