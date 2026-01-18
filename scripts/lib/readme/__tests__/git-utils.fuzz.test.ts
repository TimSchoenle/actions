import { describe, expect, it } from 'vitest';
import { fc } from '@fast-check/vitest';
import { parseGitUrl } from '../git-utils';

describe('git-utils fuzzing', () => {
  const safeStringGenerator = () => fc.stringMatching(/^[a-zA-Z0-9-_]+$/);

  describe('parseGitUrl', () => {
    it('should parse HTTPS GitHub URLs', () => {
      fc.assert(
        fc.property(safeStringGenerator(), safeStringGenerator(), (user, repo) => {
          const url = `https://github.com/${user}/${repo}.git`;
          const result = parseGitUrl(url);
          expect(result).toBe(`${user}/${repo}`);
        }),
      );
    });

    it('should parse SSH GitHub URLs', () => {
      fc.assert(
        fc.property(safeStringGenerator(), safeStringGenerator(), (user, repo) => {
          const url = `git@github.com:${user}/${repo}.git`;
          const result = parseGitUrl(url);
          expect(result).toBe(`${user}/${repo}`);
        }),
      );
    });

    it('should handle URLs without .git suffix', () => {
      fc.assert(
        fc.property(safeStringGenerator(), safeStringGenerator(), (user, repo) => {
          const urlHttps = `https://github.com/${user}/${repo}`;
          const urlSsh = `git@github.com:${user}/${repo}`;

          const resultHttps = parseGitUrl(urlHttps);
          const resultSsh = parseGitUrl(urlSsh);

          expect(resultHttps).toBe(`${user}/${repo}`);
          expect(resultSsh).toBe(`${user}/${repo}`);
        }),
      );
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
      );
    });

    it('should handle mixed case in user/repo names', () => {
      fc.assert(
        fc.property(safeStringGenerator(), safeStringGenerator(), (user, repo) => {
          const url = `https://github.com/${user}/${repo}`;
          const result = parseGitUrl(url);
          expect(result).toBe(`${user}/${repo}`);
        }),
      );
    });
  });
});
