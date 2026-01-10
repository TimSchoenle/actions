import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseGitUrl } from '../git-utils';

describe('git-utils fuzzing', () => {
  const safeStringGenerator = (allowedChars: string) =>
    fc.array(fc.constantFrom(...allowedChars.split('')), { minLength: 1 }).map((arr) => arr.join(''));

  describe('parseGitUrl', () => {
    it('should parse HTTPS GitHub URLs', () => {
      const safeUser = safeStringGenerator('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_');
      const safeRepo = safeStringGenerator('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_');

      fc.assert(
        fc.property(safeUser, safeRepo, (user, repo) => {
          const url = `https://github.com/${user}/${repo}.git`;
          const result = parseGitUrl(url);
          expect(result).toBe(`${user}/${repo}`);
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should parse SSH GitHub URLs', () => {
      const safeUser = safeStringGenerator('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_');
      const safeRepo = safeStringGenerator('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_');

      fc.assert(
        fc.property(safeUser, safeRepo, (user, repo) => {
          const url = `git@github.com:${user}/${repo}.git`;
          const result = parseGitUrl(url);
          expect(result).toBe(`${user}/${repo}`);
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should handle URLs without .git suffix', () => {
      const safeUser = safeStringGenerator('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_');
      const safeRepo = safeStringGenerator('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_');

      fc.assert(
        fc.property(safeUser, safeRepo, (user, repo) => {
          const urlHttps = `https://github.com/${user}/${repo}`;
          const urlSsh = `git@github.com:${user}/${repo}`;

          const resultHttps = parseGitUrl(urlHttps);
          const resultSsh = parseGitUrl(urlSsh);

          expect(resultHttps).toBe(`${user}/${repo}`);
          expect(resultSsh).toBe(`${user}/${repo}`);
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should handle whitespace in URLs', () => {
      const url = '  https://github.com/TimSchoenle/actions.git  ';
      const result = parseGitUrl(url);
      expect(result).toBe('TimSchoenle/actions');
    });

    it('should throw on invalid URLs', () => {
      fc.assert(
        fc.property(fc.string(), (invalidUrl) => {
          // Skip valid-looking GitHub URLs based on hostname
          try {
            const parsed = new URL(invalidUrl);
            if (parsed.hostname === 'github.com') return true;
          } catch {
            // Ignore parsing errors here; they will be handled by parseGitUrl
          }

          expect(() => parseGitUrl(invalidUrl)).toThrow('Could not parse git remote url');
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should handle mixed case in user/repo names', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).filter((s) => /^[a-zA-Z0-9-_]+$/.test(s)),
          fc.string({ minLength: 1 }).filter((s) => /^[a-zA-Z0-9-_]+$/.test(s)),
          (user, repo) => {
            const url = `https://github.com/${user}/${repo}`;
            const result = parseGitUrl(url);
            expect(result).toBe(`${user}/${repo}`);
          },
        ),
        { numRuns: 30 },
      );
      expect(true).toBe(true);
    });

    it('should preserve hyphens and underscores', () => {
      const testCases = [
        ['my-user', 'my-repo'],
        ['user_name', 'repo_name'],
        ['a-b-c', 'd_e_f'],
      ];

      for (const [user, repo] of testCases) {
        const url = `https://github.com/${user}/${repo}.git`;
        const result = parseGitUrl(url);
        expect(result).toBe(`${user}/${repo}`);
      }
    });

    it('should handle repos with dots in names', () => {
      const url1 = 'https://github.com/user/repo.js';
      const url2 = 'https://github.com/user/v1.2.3';

      const result1 = parseGitUrl(url1);
      const result2 = parseGitUrl(url2);

      expect(result1).toBe('user/repo.js');
      expect(result2).toBe('user/v1.2.3');
    });
  });
});
