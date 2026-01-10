import { describe, expect } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { generateFullActionName, generateTagPrefix, generateVersioningRegex } from '../renovate-config';

const safeString = fc.stringMatching(/^[a-zA-Z0-9-]+$/);

describe('renovate-config fuzzing', () => {
  describe('generateFullActionName', () => {
    test.prop([safeString, safeString, safeString])('should correctly join parts with slashes', (repo, pkg, sub) => {
      const result = generateFullActionName(repo, pkg, sub);
      return result === `${repo}/actions/${pkg}/${sub}`;
    });

    test.prop([safeString, safeString, safeString])(
      'should always contain /actions/ in the middle',
      (repo, pkg, sub) => {
        const result = generateFullActionName(repo, pkg, sub);
        expect(result).toContain('/actions/');
      },
    );

    test.prop([safeString, safeString, safeString])('should have exactly 4 path segments', (repo, pkg, sub) => {
      const result = generateFullActionName(repo, pkg, sub);
      const segments = result.split('/');
      expect(segments.length).toBe(4); // repo, actions, pkg, sub
      expect(segments[0]).toBe(repo);
      expect(segments[1]).toBe('actions');
      expect(segments[2]).toBe(pkg);
      expect(segments[3]).toBe(sub);
    });
  });

  describe('generateTagPrefix', () => {
    test.prop([safeString, safeString])('should start with actions-', (pkg, sub) => {
      const result = generateTagPrefix(pkg, sub);
      return result.startsWith('actions-');
    });

    test.prop([safeString, safeString])('should never contain slashes', (pkg, sub) => {
      const result = generateTagPrefix(pkg, sub);
      expect(result).not.toContain('/');
    });

    test.prop([safeString, safeString])('should have consistent format', (pkg, sub) => {
      const result = generateTagPrefix(pkg, sub);
      // Should be: actions-{pkg}-{sub}
      const expected = `actions-${pkg}-${sub}`.replaceAll('/', '-');
      expect(result).toBe(expected);
    });
  });

  describe('generateVersioningRegex', () => {
    test.prop([safeString])('should generate a valid regex string', (prefix) => {
      const regexStr = generateVersioningRegex(prefix);
      try {
        new RegExp(regexStr);
        return true;
      } catch {
        return false;
      }
    });

    test.prop([safeString, fc.nat(), fc.nat(), fc.nat()])(
      'should match a valid version string created from the prefix',
      (prefix, major, minor, patch) => {
        const regexStr = generateVersioningRegex(prefix);
        const regex = new RegExp(regexStr);
        const versionString = `${prefix}-v${major}.${minor}.${patch}`;
        return regex.test(versionString);
      },
    );

    test.prop([safeString, fc.nat({ max: 100 }), fc.nat({ max: 100 }), fc.nat({ max: 100 })])(
      'should capture major, minor, and patch groups',
      (prefix, major, minor, patch) => {
        const regexStr = generateVersioningRegex(prefix);
        const regex = new RegExp(regexStr);
        const versionString = `${prefix}-v${major}.${minor}.${patch}`;
        const match = regex.exec(versionString);

        expect(match).not.toBeNull();
        if (match) {
          expect(match.groups?.major).toBe(String(major));
          expect(match.groups?.minor).toBe(String(minor));
          expect(match.groups?.patch).toBe(String(patch));
        }
      },
    );

    test.prop([safeString, safeString])(
      'should NOT match strings without the correct prefix',
      (prefix, wrongPrefix) => {
        // Skip if they're the same
        if (prefix === wrongPrefix) return true;

        const regexStr = generateVersioningRegex(prefix);
        const regex = new RegExp(regexStr);
        const versionString = `${wrongPrefix}-v1.2.3`;

        expect(regex.test(versionString)).toBe(false);
      },
    );

    test.prop([safeString, fc.nat(), fc.nat(), fc.nat()])(
      'should NOT match versions without -v prefix',
      (prefix, major, minor, patch) => {
        const regexStr = generateVersioningRegex(prefix);
        const regex = new RegExp(regexStr);
        // Missing the -v
        const invalidVersion = `${prefix}${major}.${minor}.${patch}`;
        expect(regex.test(invalidVersion)).toBe(false);
      },
    );
  });
});
