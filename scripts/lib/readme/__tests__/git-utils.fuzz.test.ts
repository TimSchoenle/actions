import { describe, expect } from 'vitest';
import { test as fcTest, fc } from '@fast-check/vitest';
import { parseGitUrl } from '../git-utils';

describe('git-utils fuzzing', () => {
  const safeStringGenerator = () => fc.stringMatching(/^[a-zA-Z0-9-_]+$/);

  describe('parseGitUrl', () => {
    fcTest.prop([safeStringGenerator(), safeStringGenerator()])('should parse HTTPS GitHub URLs', (user, repo) => {
      const url = `https://github.com/${user}/${repo}.git`;
      const result = parseGitUrl(url);
      expect(result).toBe(`${user}/${repo}`);
    });

    fcTest.prop([safeStringGenerator(), safeStringGenerator()])('should parse SSH GitHub URLs', (user, repo) => {
      const url = `git@github.com:${user}/${repo}.git`;
      const result = parseGitUrl(url);
      expect(result).toBe(`${user}/${repo}`);
    });

    fcTest.prop([safeStringGenerator(), safeStringGenerator()])(
      'should handle URLs without .git suffix',
      (user, repo) => {
        const urlHttps = `https://github.com/${user}/${repo}`;
        const urlSsh = `git@github.com:${user}/${repo}`;

        const resultHttps = parseGitUrl(urlHttps);
        const resultSsh = parseGitUrl(urlSsh);

        expect(resultHttps).toBe(`${user}/${repo}`);
        expect(resultSsh).toBe(`${user}/${repo}`);
      },
    );

    fcTest.prop([fc.string()])('should throw on invalid URLs', (invalidUrl) => {
      // Skip valid-looking GitHub URLs based on hostname
      try {
        const parsed = new URL(invalidUrl);
        if (parsed.hostname === 'github.com') return true;
      } catch {
        // Ignore parsing errors here; they will be handled by parseGitUrl
      }

      expect(() => parseGitUrl(invalidUrl)).toThrow('Could not parse git remote url');
    });

    fcTest.prop([safeStringGenerator(), safeStringGenerator()])(
      'should handle mixed case in user/repo names',
      (user, repo) => {
        const url = `https://github.com/${user}/${repo}`;
        const result = parseGitUrl(url);
        expect(result).toBe(`${user}/${repo}`);
      },
    );
  });
});
