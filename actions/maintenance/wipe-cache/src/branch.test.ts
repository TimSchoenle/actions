import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { resolveBranch } from './branch.js';

describe('resolveBranch', () => {
  it.each([
    ['main', 'main'],
    ['feature/x', 'feature/x'],
    ['renovate/npm-actions-core-3.x', 'renovate/npm-actions-core-3.x'],
    ['refs/heads/main', 'main'],
    ['refs/heads/feature/x', 'feature/x'],
    ['release-please--branches--main', 'release-please--branches--main'],
  ])('resolves %j to the branch %j', (input, name) => {
    expect(resolveBranch(input)).toEqual({ name, ref: `refs/heads/${name}` });
  });

  // A branch may itself be called `refs/heads/...` only after the namespace prefix, which is why the
  // prefix is stripped once and not repeatedly.
  it('strips the namespace prefix once', () => {
    expect(resolveBranch('refs/heads/heads/x')).toEqual({ name: 'heads/x', ref: 'refs/heads/heads/x' });
  });

  it.each(['', ' ', '\n'])('refuses the empty branch %j and names the fix', (input) => {
    expect(() => resolveBranch(input)).toThrow(/No branch to wipe.*Pass 'branch' explicitly/s);
  });

  it('refuses a full ref that names no branch', () => {
    expect(() => resolveBranch('refs/heads/')).toThrow('the ref names no branch');
  });

  // Nesting these under refs/heads/ would silently target a branch nobody named.
  it.each(['refs/tags/v1.0.0', 'refs/pull/12/merge', 'refs/remotes/origin/main', 'refs/heads/refs/tags/v1'])(
    'refuses the non-branch ref %j',
    (input) => {
      expect(() => resolveBranch(input)).toThrow('only branches can be wiped');
    },
  );

  it.each([
    ['feature x', 'whitespace'],
    ['feature\tx', 'whitespace'],
    ['feature\nx', 'whitespace'],
    ['feature\u007Fx', 'whitespace'],
    ['a~1', 'whitespace'],
    ['a^1', 'whitespace'],
    ['a:b', 'whitespace'],
    ['a?b', 'whitespace'],
    ['a*b', 'whitespace'],
    ['a[b', 'whitespace'],
    ['a\\b', 'whitespace'],
    ['a..b', "contains '..'"],
    ['a@{1}', "contains '@{'"],
    ['-x', "starts with '-'"],
    ['x.', "ends with '.'"],
    ['@', "is '@'"],
    ['/x', 'segment is empty'],
    ['x/', 'segment is empty'],
    ['a//b', 'segment is empty'],
    ['a/.hidden', "starts with '.'"],
    ['x.lock', "ends with '.lock'"],
    ['x.lock/y', "ends with '.lock'"],
  ])('refuses the malformed branch %j', (input, reason) => {
    expect(() => resolveBranch(input)).toThrow(reason);
  });

  it('quotes the rejected input so a newline cannot reach the log raw', () => {
    expect(() => resolveBranch('a\n::error::x')).toThrow('Invalid branch "a\\n::error::x"');
  });
});

describe('resolveBranch fuzzing', () => {
  const segment = fc.stringMatching(/^[a-z0-9][\w-]{0,20}$/);
  const branch = fc.array(segment, { minLength: 1, maxLength: 4 }).map((parts) => parts.join('/'));

  it('resolves a short name and its full ref to the same target', () => {
    fc.assert(
      fc.property(branch, (name) => {
        expect(resolveBranch(`refs/heads/${name}`)).toEqual(resolveBranch(name));
      }),
    );
  });

  it('always produces a refs/heads/ ref whose suffix is the name', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        let target;
        try {
          target = resolveBranch(input);
        } catch {
          return;
        }

        expect(target.ref).toBe(`refs/heads/${target.name}`);
        expect(target.name.startsWith('refs/')).toBe(false);
        expect(target.name).not.toMatch(/\s/);
      }),
    );
  });
});
