import { describe, expect, it } from 'vitest';

import { InputContractError, inputEnvName, resolveInputEnv } from './action-inputs.js';
import { parseActionManifest } from './action-manifest.js';

import type { ActionManifest } from './action-manifest.js';

function manifestWith(inputs: string): ActionManifest {
  return parseActionManifest(
    `name: 'Example'\ninputs:\n${inputs}runs:\n  using: 'node20'\n  main: 'dist/index.js'\n`,
    'actions/common/example',
  );
}

const BRANCH_INPUTS = `  token:
    description: 'Token'
    required: true
  base_branch:
    description: 'Base'
    default: ''
  reset_branch:
    description: 'Reset'
    default: 'false'
`;

describe('inputEnvName', () => {
  it('uppercases and replaces spaces, exactly as @actions/core does', () => {
    expect(inputEnvName('branch name')).toBe('INPUT_BRANCH_NAME');
  });

  it('leaves a hyphen alone, because the runner does too', () => {
    expect(inputEnvName('app-id')).toBe('INPUT_APP-ID');
  });
});

describe('resolveInputEnv', () => {
  it('applies the defaults declared in action.yaml', () => {
    expect(resolveInputEnv(manifestWith(BRANCH_INPUTS), { token: 'secret' })).toEqual({
      INPUT_TOKEN: 'secret',
      INPUT_BASE_BRANCH: '',
      INPUT_RESET_BRANCH: 'false',
    });
  });

  it('lets a supplied value win over the default', () => {
    const env = resolveInputEnv(manifestWith(BRANCH_INPUTS), { token: 'secret', reset_branch: 'true' });

    expect(env['INPUT_RESET_BRANCH']).toBe('true');
  });

  it('rejects an input the action does not declare', () => {
    const resolve = (): unknown => resolveInputEnv(manifestWith(BRANCH_INPUTS), { token: 'secret', branch: 'x' });

    expect(resolve).toThrow(InputContractError);
    expect(resolve).toThrow(/not declared .*: branch/);
  });

  it('rejects a required input that was neither supplied nor defaulted', () => {
    expect(() => resolveInputEnv(manifestWith(BRANCH_INPUTS), {})).toThrow(/not supplied: token/);
  });

  it('omits a required input when the case passes undefined on purpose', () => {
    const env = resolveInputEnv(manifestWith(BRANCH_INPUTS), { token: undefined });

    expect(env).not.toHaveProperty('INPUT_TOKEN');
  });

  it('rejects an action whose inputs collide on one environment variable', () => {
    const manifest = manifestWith("  'a b':\n    description: 'One'\n  a_b:\n    description: 'Two'\n");

    expect(() => resolveInputEnv(manifest, {})).toThrow(/both map to INPUT_A_B/);
  });
});
