import { describe, expect, it } from 'vitest';

import { parsePullRequestUrl } from './pull-request-url.js';

describe('parsePullRequestUrl', () => {
  it('extracts owner, repo and number from a canonical URL', () => {
    expect(parsePullRequestUrl('https://github.com/owner/repo/pull/123')).toEqual({
      number: 123,
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('ignores a trailing path such as /files', () => {
    expect(parsePullRequestUrl('https://github.com/owner/repo/pull/7/files')).toEqual({
      number: 7,
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('ignores a query string and fragment', () => {
    expect(parsePullRequestUrl('https://github.com/o/r/pull/42?w=1#discussion')).toMatchObject({ number: 42 });
  });

  it('does not confuse the host with the repository', () => {
    expect(parsePullRequestUrl('https://github.example.com/my-org/my-repo/pull/9')).toEqual({
      number: 9,
      owner: 'my-org',
      repo: 'my-repo',
    });
  });

  it.each(['', 'not a url', 'https://github.com/owner/repo/issues/1', 'https://github.com/owner/repo/pull/abc'])(
    'throws for the unparseable URL %j',
    (url) => {
      expect(() => parsePullRequestUrl(url)).toThrow('Invalid pull request URL');
    },
  );
});
