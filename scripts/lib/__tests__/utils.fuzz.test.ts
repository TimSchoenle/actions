import { describe, expect } from 'vitest';
import { test as fcTest, fc } from '@fast-check/vitest';
import { capitalize, replaceTemplateVariables, parseRepoName } from '../utils';

describe('utils fuzzing', () => {
  describe('capitalize', () => {
    fcTest.prop([fc.string({ minLength: 1 })])(
      'should always start with an uppercase letter if input is not empty',
      (str) => {
        const result = capitalize(str);
        if (result.length === 0) return true;
        const firstChar = result[0];
        expect(firstChar).toBe(firstChar.toUpperCase());
      },
    );

    fcTest.prop([fc.string()])('should not change the length of the string', (str) => {
      const result = capitalize(str);
      expect(result.length).toBe(str.length);
    });

    fcTest.prop([fc.string()])('should be idempotent (applying twice gives same result as once)', (str) => {
      const once = capitalize(str);
      const twice = capitalize(once);
      expect(once).toBe(twice);
    });

    fcTest.prop([fc.string({ minLength: 2 })])('should only change the first character', (str) => {
      const result = capitalize(str);
      // All characters after first should remain unchanged
      expect(result.slice(1)).toBe(str.slice(1));
    });

    fcTest.prop([fc.string({ minLength: 1, maxLength: 1 })])('should handle single characters', (char) => {
      const result = capitalize(char);
      expect(result).toBe(char.toUpperCase());
    });
  });

  const safeStringGenerator = () => fc.stringMatching(/^[a-zA-Z0-9_]+$/);

  describe('replaceTemplateVariables', () => {
    fcTest.prop([fc.string(), safeStringGenerator(), fc.string()])(
      'should correctly replace variables',
      (prefix, key, value) => {
        // Avoid accidental double substitution or recursive substitution in this simple test
        if (prefix.includes('{{') || value.includes('{{')) return true;

        const template = `${prefix}{{${key}}}`;
        const replacements = { [key]: value };
        const result = replaceTemplateVariables(template, replacements);

        expect(result).toBe(`${prefix}${value}`);
      },
    );

    fcTest.prop([fc.string(), fc.dictionary(fc.string({ minLength: 1 }), fc.string())])(
      'should not change content if keys are not present',
      (content, replacements) => {
        // Start with simple case: content doesn't have {{
        if (content.includes('{{')) return true;

        const result = replaceTemplateVariables(content, replacements);
        expect(result).toBe(content);
      },
    );

    fcTest.prop([fc.dictionary(safeStringGenerator(), fc.string(), { minKeys: 2, maxKeys: 5 })])(
      'should handle multiple replacements',
      (replacements) => {
        const keys = Object.keys(replacements);
        const template = keys.map((k) => `{{${k}}}`).join(' - ');
        const result = replaceTemplateVariables(template, replacements);

        // Check all values are present
        for (const value of Object.values(replacements)) {
          expect(result).toContain(value);
        }
      },
    );
  });

  describe('parseRepoName', () => {
    fcTest.prop([fc.stringMatching(/^[a-zA-Z0-9-_]+$/), fc.stringMatching(/^[a-zA-Z0-9-_.]{1,50}$/)])(
      'should parse valid git urls',
      (user, repo) => {
        const urlHttps = `https://github.com/${user}/${repo}`;
        const urlSsh = `git@github.com:${user}/${repo}`;

        const resultHttps = parseRepoName(urlHttps);
        const resultSsh = parseRepoName(urlSsh);

        expect(resultHttps).toBe(`${user}/${repo}`);
        expect(resultSsh).toBe(`${user}/${repo}`);
      },
    );
  });
});
