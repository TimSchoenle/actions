import { describe, expect, it } from 'vitest';
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
      );
    });

    it('should not change the length of the string', () => {
      fc.assert(
        fc.property(fc.string(), (str) => {
          const result = capitalize(str);
          expect(result.length).toBe(str.length);
        }),
      );
    });

    it('should be idempotent (applying twice gives same result as once)', () => {
      fc.assert(
        fc.property(fc.string(), (str) => {
          const once = capitalize(str);
          const twice = capitalize(once);
          expect(once).toBe(twice);
        }),
      );
    });

    it('should only change the first character', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 2 }), (str) => {
          const result = capitalize(str);
          // All characters after first should remain unchanged
          expect(result.slice(1)).toBe(str.slice(1));
        }),
      );
    });

    it('should handle single characters', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 1 }), (char) => {
          const result = capitalize(char);
          expect(result).toBe(char.toUpperCase());
        }),
      );
    });
  });

  const safeStringGenerator = () => fc.stringMatching(/^[a-zA-Z0-9_]+$/);

  describe('replaceTemplateVariables', () => {
    it('should correctly replace variables', () => {
      fc.assert(
        fc.property(fc.string(), safeStringGenerator(), fc.string(), (prefix, key, value) => {
          // Avoid accidental double substitution or recursive substitution in this simple test
          if (prefix.includes('{{') || value.includes('{{')) return true;

          const template = `${prefix}{{${key}}}`;
          const replacements = { [key]: value };
          const result = replaceTemplateVariables(template, replacements);

          expect(result).toBe(`${prefix}${value}`);
        }),
      );
    });

    it('should not change content if keys are not present', () => {
      fc.assert(
        fc.property(fc.string(), fc.dictionary(fc.string({ minLength: 1 }), fc.string()), (content, replacements) => {
          // Start with simple case: content doesn't have {{
          if (content.includes('{{')) return true;

          const result = replaceTemplateVariables(content, replacements);
          expect(result).toBe(content);
        }),
      );
    });

    it('should handle multiple replacements', () => {
      fc.assert(
        fc.property(fc.dictionary(safeStringGenerator(), fc.string(), { minKeys: 2, maxKeys: 5 }), (replacements) => {
          const keys = Object.keys(replacements);
          const template = keys.map((k) => `{{${k}}}`).join(' - ');
          const result = replaceTemplateVariables(template, replacements);

          // Check all values are present
          for (const value of Object.values(replacements)) {
            expect(result).toContain(value);
          }
        }),
      );
    });
  });

  describe('parseRepoName', () => {
    it('should parse valid git urls', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-zA-Z0-9-_]+$/),
          fc.stringMatching(/^[a-zA-Z0-9-_.]{1,50}$/),
          (user, repo) => {
            const urlHttps = `https://github.com/${user}/${repo}`;
            const urlSsh = `git@github.com:${user}/${repo}`;

            const resultHttps = parseRepoName(urlHttps);
            const resultSsh = parseRepoName(urlSsh);

            expect(resultHttps).toBe(`${user}/${repo}`);
            expect(resultSsh).toBe(`${user}/${repo}`);
          },
        ),
      );
    });
  });
});
