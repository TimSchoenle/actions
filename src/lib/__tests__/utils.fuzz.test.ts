import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { capitalize, replaceTemplateVariables, parseRepoName } from '../utils';

describe('utils fuzzing', () => {
  describe('capitalize', () => {
    it('should always start with an uppercase letter if input is not empty', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (str) => {
          const result = capitalize(str);
          if (result.length === 0) return true;
          const firstChar = result[0];
          expect(firstChar).toBe(firstChar.toUpperCase());
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should not change the length of the string', () => {
      fc.assert(
        fc.property(fc.string(), (str) => {
          const result = capitalize(str);
          expect(result.length).toBe(str.length);
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should be idempotent (applying twice gives same result as once)', () => {
      fc.assert(
        fc.property(fc.string(), (str) => {
          const once = capitalize(str);
          const twice = capitalize(once);
          expect(once).toBe(twice);
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should only change the first character', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 2 }), (str) => {
          const result = capitalize(str);
          // All characters after first should remain unchanged
          expect(result.slice(1)).toBe(str.slice(1));
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should handle empty strings', () => {
      const result = capitalize('');
      expect(result).toBe('');
    });

    it('should handle single characters', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 1 }), (char) => {
          const result = capitalize(char);
          expect(result).toBe(char.toUpperCase());
        }),
        { numRuns: 30 },
      );
      expect(true).toBe(true);
    });

    it('should preserve non-alphabetic first characters', () => {
      const testCases = ['123abc', '  test', '___hello', '!!!world'];
      for (const test of testCases) {
        const result = capitalize(test);
        expect(result[0]).toBe(test[0].toUpperCase());
      }
    });
  });

  const safeStringGenerator = (allowedChars: string) =>
    fc.array(fc.constantFrom(...allowedChars.split('')), { minLength: 1 }).map((arr) => arr.join(''));

  describe('replaceTemplateVariables', () => {
    it('should correctly replace variables', () => {
      const safeKey = safeStringGenerator('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_');
      fc.assert(
        fc.property(fc.string(), safeKey, fc.string(), (prefix, key, value) => {
          // Avoid accidental double substitution or recursive substitution in this simple test
          if (prefix.includes('{{') || value.includes('{{')) return true;

          const template = `${prefix}{{${key}}}`;
          const replacements = { [key]: value };
          const result = replaceTemplateVariables(template, replacements);

          expect(result).toBe(`${prefix}${value}`);
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should not change content if keys are not present', () => {
      fc.assert(
        fc.property(fc.string(), fc.dictionary(fc.string({ minLength: 1 }), fc.string()), (content, replacements) => {
          // Start with simple case: content doesn't have {{
          if (content.includes('{{')) return true;

          const result = replaceTemplateVariables(content, replacements);
          expect(result).toBe(content);
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should handle keys with special regex characters', () => {
      const testCases = [
        ['(test)', 'value1'],
        ['[key]', 'value2'],
        ['a*b', 'value3'],
        ['x+y', 'value4'],
        ['a|b', 'value5'],
      ];

      for (const [key, value] of testCases) {
        const template = `prefix{{${key}}}suffix`;
        const result = replaceTemplateVariables(template, { [key]: value });
        expect(result).toBe(`prefix${value}suffix`);
      }
    });

    it('should handle replacement values with $ signs', () => {
      const template = 'Hello {{name}}!';
      const result = replaceTemplateVariables(template, { name: '$100' });
      expect(result).toBe('Hello $100!');
    });

    it('should handle numeric keys', () => {
      const template = 'Key {{1}} and {{2}} and {{123}}';
      const result = replaceTemplateVariables(template, { '1': 'one', '2': 'two', '123': 'oneTwoThree' });
      expect(result).toBe('Key one and two and oneTwoThree');
    });

    it('should handle multiple replacements', () => {
      fc.assert(
        fc.property(
          fc.dictionary(safeStringGenerator('abcdefghijklmnopqrstuvwxyz'), fc.string(), { minKeys: 2, maxKeys: 5 }),
          (replacements) => {
            const keys = Object.keys(replacements);
            const template = keys.map((k) => `{{${k}}}`).join(' - ');
            const result = replaceTemplateVariables(template, replacements);

            // Check all values are present
            for (const value of Object.values(replacements)) {
              expect(result).toContain(value);
            }
          },
        ),
        { numRuns: 30 },
      );
      expect(true).toBe(true);
    });

    it('should handle empty replacement values', () => {
      const template = 'Before{{key}}After';
      const result = replaceTemplateVariables(template, { key: '' });
      expect(result).toBe('BeforeAfter');
    });
  });

  describe('parseRepoName', () => {
    it('should parse valid git urls', () => {
      const safeUser = safeStringGenerator('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_');
      const safeRepo = safeStringGenerator('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.');

      fc.assert(
        fc.property(safeUser, safeRepo, (user, repo) => {
          const urlHttps = `https://github.com/${user}/${repo}`;
          const urlSsh = `git@github.com:${user}/${repo}`;

          const resultHttps = parseRepoName(urlHttps);
          const resultSsh = parseRepoName(urlSsh);

          expect(resultHttps).toBe(`${user}/${repo}`);
          expect(resultSsh).toBe(`${user}/${repo}`);
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should handle .git suffix', () => {
      const testCases = ['https://github.com/user/repo.git', 'git@github.com:user/repo.git'];

      for (const url of testCases) {
        const result = parseRepoName(url);
        expect(result).toBe('user/repo');
        expect(result).not.toContain('.git');
      }
    });

    it('should handle whitespace', () => {
      const result1 = parseRepoName('  https://github.com/user/repo  ');
      const result2 = parseRepoName('\ngit@github.com:user/repo\n');

      expect(result1).toBe('user/repo');
      expect(result2).toBe('user/repo');
    });

    it('should throw for invalid URLs', () => {
      const invalidUrls = ['not-a-url', 'https://gitlab.com/user/repo', 'just-random-text', ''];

      for (const url of invalidUrls) {
        expect(() => parseRepoName(url)).toThrow();
      }
    });
  });
});
