import { describe, expect, it } from 'vitest';

import { parseActionManifest, UnsupportedActionError } from './action-manifest.js';

const DIRECTORY = 'actions/common/example';

function manifest(body: string): string {
  return `name: 'Example'\n${body}`;
}

describe('parseActionManifest', () => {
  it('reads the declared inputs, defaults and outputs', () => {
    const parsed = parseActionManifest(
      manifest(`inputs:
  token:
    description: 'Token'
    required: true
  reset_branch:
    description: 'Reset'
    default: 'false'
outputs:
  sha:
    description: 'SHA'
runs:
  using: 'node20'
  main: 'dist/index.js'
`),
      DIRECTORY,
    );

    expect(parsed.inputs.get('token')).toEqual({ name: 'token', required: true, default: undefined });
    expect(parsed.inputs.get('reset_branch')).toEqual({ name: 'reset_branch', required: false, default: 'false' });
    expect([...parsed.outputs]).toEqual(['sha']);
    expect(parsed.main).toBe('dist/index.js');
  });

  it('stringifies a non-string default, because the runner only ever delivers strings', () => {
    const parsed = parseActionManifest(
      manifest(`inputs:
  enabled:
    description: 'Enabled'
    default: false
  count:
    description: 'Count'
    default: 0
runs:
  using: 'node20'
  main: 'dist/index.js'
`),
      DIRECTORY,
    );

    expect(parsed.inputs.get('enabled')?.default).toBe('false');
    expect(parsed.inputs.get('count')?.default).toBe('0');
  });

  it('keeps a workflow-expression default out of the applicable defaults', () => {
    const parsed = parseActionManifest(
      manifest(`inputs:
  repository:
    description: 'Repository'
    default: \${{ github.repository }}
runs:
  using: 'node20'
  main: 'dist/index.js'
`),
      DIRECTORY,
    );

    expect(parsed.inputs.get('repository')).toEqual({
      name: 'repository',
      required: false,
      default: undefined,
      contextDefault: '${{ github.repository }}',
    });
  });

  it('refuses a composite action, naming the runtime it found', () => {
    const parse = (): unknown => parseActionManifest(manifest("runs:\n  using: 'composite'\n  steps: []\n"), DIRECTORY);

    expect(parse).toThrow(UnsupportedActionError);
    expect(parse).toThrow(/runs.using is 'composite'/);
  });

  it('refuses a node20 action with no entry point', () => {
    expect(() => parseActionManifest(manifest("runs:\n  using: 'node20'\n"), DIRECTORY)).toThrow(/runs.main/);
  });
});
