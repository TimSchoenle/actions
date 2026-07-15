import { fc, it } from '@fast-check/vitest';
import { describe, expect } from 'vitest';

import { parsePullRequestUrl } from './pull-request-url.js';

const segment = fc.stringMatching(/^[a-zA-Z0-9._-]{1,30}$/);

describe('parsePullRequestUrl properties', () => {
  it.prop([segment, segment, fc.integer({ max: 1_000_000, min: 1 })])(
    'round-trips a well-formed pull request URL',
    (owner, repo, number) => {
      expect(parsePullRequestUrl(`https://github.com/${owner}/${repo}/pull/${number}`)).toEqual({
        number,
        owner,
        repo,
      });
    },
  );

  it.prop([fc.webUrl()])('either parses to a positive integer number or throws — never NaN', (url) => {
    let parsed;

    try {
      parsed = parsePullRequestUrl(url);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      return;
    }

    expect(Number.isInteger(parsed.number)).toBe(true);
    expect(parsed.number).toBeGreaterThan(0);
    expect(parsed.owner).not.toBe('');
    expect(parsed.repo).not.toBe('');
  });
});
