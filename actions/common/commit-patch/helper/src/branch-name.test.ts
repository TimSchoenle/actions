import { describe, expect, it } from 'vitest';

import { validateBranchName } from './branch-name.js';

describe('validateBranchName', () => {
  it.each(['main', 'feature/x', 'renovate/foo-1.x', 'release-please--branches--main', 'a.b', 'user@host', 'v1.2.3'])(
    'accepts %s',
    (name) => {
      expect(validateBranchName(name)).toBe(name);
    },
  );

  // A branch literally named refs/heads/main passes a string comparison with the default branch name,
  // and may resolve to the default branch itself on the write.
  it.each([
    ['a full ref name', 'refs/heads/main'],
    ['any refs/ prefix', 'refs/tags/v1'],
    ['an empty name', ''],
    ['a leading dash, which git reads as an option', '-main'],
    ['a double dot', 'a..b'],
    ['a reflog expression', 'main@{1}'],
    ['a lone @', '@'],
    ['a space', 'a b'],
    ['a control character', 'a\tb'],
    ['a tilde', 'a~1'],
    ['a caret', 'a^'],
    ['a colon', 'a:b'],
    ['a question mark', 'a?'],
    ['an asterisk', 'a*'],
    ['an open bracket', 'a[b'],
    ['a backslash', String.raw`a\b`],
    ['a leading slash', '/main'],
    ['a trailing slash', 'main/'],
    ['a double slash', 'a//b'],
    ['a trailing dot', 'main.'],
    ['a component starting with a dot', 'a/.b'],
    ['a component ending in .lock', 'a.lock/b'],
    ['a DEL character', 'a\u007Fb'],
  ])('rejects %s', (_name, value) => {
    expect(() => validateBranchName(value)).toThrow(/branch/);
  });
});
