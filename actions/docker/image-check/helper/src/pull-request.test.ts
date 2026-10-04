import { describe, expect, it } from 'vitest';

import { codeScanningUrl, isFork, pullRequestFromEvent } from './pull-request.js';

function payload(fullName: string | null) {
  return { pull_request: { number: 7, head: { repo: fullName === null ? null : { full_name: fullName } } } };
}

describe('pullRequestFromEvent', () => {
  it('reads the number and the head repository', () => {
    expect(pullRequestFromEvent(payload('acme/app'))).toEqual({ number: 7, headRepository: 'acme/app' });
  });

  it.each([
    ['a push', { ref: 'refs/heads/main' }],
    ['no payload', undefined],
    ['a pull request without a number', { pull_request: { head: {} } }],
    ['a pull request number that is not a positive integer', { pull_request: { number: 0 } }],
  ])('finds no pull request in %s', (_case, event) => {
    expect(pullRequestFromEvent(event)).toBeUndefined();
  });

  it('reports a deleted fork as having no head repository', () => {
    expect(pullRequestFromEvent(payload(null))).toEqual({ number: 7, headRepository: undefined });
  });
});

describe('isFork', () => {
  it('is false for a branch of the same repository, whatever the case', () => {
    expect(isFork({ number: 7, headRepository: 'Acme/App' }, 'acme/app')).toBe(false);
  });

  it('is true for another repository', () => {
    expect(isFork({ number: 7, headRepository: 'mallory/app' }, 'acme/app')).toBe(true);
  });

  // GitHub drops head.repo once the fork is deleted; the token is still read-only.
  it('is true when the head repository is gone', () => {
    expect(isFork({ number: 7, headRepository: undefined }, 'acme/app')).toBe(true);
  });
});

describe('codeScanningUrl', () => {
  it('filters code scanning to the pull request', () => {
    expect(codeScanningUrl('https://github.com/', 'acme/app', 7)).toBe(
      'https://github.com/acme/app/security/code-scanning?query=pr%3A7',
    );
  });
});
