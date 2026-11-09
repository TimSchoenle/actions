import { fileURLToPath } from 'node:url';

import { runAction } from 'actions-e2e';
import { describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';

/**
 * End-to-end cases for `actions/common/download-release-asset`: the committed bundle, run the way
 * the runner runs it.
 *
 * Every case here is refused before the first request, so none needs the network or a token. The
 * downloads themselves, the forced REST API fallback included, are the extra jobs in
 * `extra-jobs.yaml`.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
const DIGEST = 'a'.repeat(64);

const DEFAULTS = {
  repository: 'jdx/jactionlint',
  tag: 'v2.5.0',
  asset: 'jactionlint_2.5.0_linux_amd64.tar.gz',
  token: '',
  sha256: DIGEST,
  'checksums-asset': '',
  'checksums-sha256': '',
} as const;

describe('download-release-asset', () => {
  it.each([
    { description: 'no verification', inputs: { sha256: '' }, reason: /sha256: set sha256/ },
    {
      description: 'both verifications',
      inputs: { 'checksums-asset': 'sums.txt', 'checksums-sha256': DIGEST },
      reason: /not both/,
    },
    {
      description: 'a checksums file without its pin',
      inputs: { sha256: '', 'checksums-asset': 'sums.txt' },
      reason: /checksums-sha256: .* must be set together/,
    },
    { description: 'a pin that is not a SHA-256', inputs: { sha256: 'abc' }, reason: /64 hex digits/ },
    { description: 'a repository without an owner', inputs: { repository: 'jactionlint' }, reason: /repository: / },
    { description: 'a tag that climbs the URL path', inputs: { tag: 'v1/../../x' }, reason: /tag: / },
    { description: 'an asset with a path separator', inputs: { asset: '../x' }, reason: /asset: / },
  ])('refuses $description', async ({ inputs, reason }) => {
    const result = await runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { ...DEFAULTS, ...inputs },
      expect: 'failure',
    });

    expect(result.errors.join('\n')).toMatch(reason);
    expect(result.outputs).toEqual({});
  });
});
