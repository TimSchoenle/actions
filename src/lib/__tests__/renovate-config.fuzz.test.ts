import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generateFullActionName, generateTagPrefix, generateVersioningRegex } from '../renovate-config';

const safeString = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'.split('')), {
    minLength: 1,
  })
  .map((arr) => arr.join(''));

describe('renovate-config fuzzing', () => {
  describe('generateFullActionName', () => {
    it('should correctly join parts with slashes', () => {
      fc.assert(
        fc.property(safeString, safeString, safeString, (repo, pkg, sub) => {
          const result = generateFullActionName(repo, pkg, sub);
          return result === `${repo}/actions/${pkg}/${sub}`;
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should always contain /actions/ in the middle', () => {
      fc.assert(
        fc.property(safeString, safeString, safeString, (repo, pkg, sub) => {
          const result = generateFullActionName(repo, pkg, sub);
          expect(result).toContain('/actions/');
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should have exactly 4 path segments', () => {
      fc.assert(
        fc.property(safeString, safeString, safeString, (repo, pkg, sub) => {
          const result = generateFullActionName(repo, pkg, sub);
          const segments = result.split('/');
          expect(segments.length).toBe(4); // repo, actions, pkg, sub
          expect(segments[0]).toBe(repo);
          expect(segments[1]).toBe('actions');
          expect(segments[2]).toBe(pkg);
          expect(segments[3]).toBe(sub);
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should handle hyphens in all components', () => {
      const result = generateFullActionName('my-repo', 'my-pkg', 'my-sub');
      expect(result).toBe('my-repo/actions/my-pkg/my-sub');
    });
  });

  describe('generateTagPrefix', () => {
    it('should start with actions-', () => {
      fc.assert(
        fc.property(safeString, safeString, (pkg, sub) => {
          const result = generateTagPrefix(pkg, sub);
          return result.startsWith('actions-');
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should replace slashes with hyphens', () => {
      // Test with a known string containing slashes
      const prefix = generateTagPrefix('my/package', 'my/sub');
      expect(prefix).toBe('actions-my-package-my-sub');
      expect(prefix).not.toContain('/');
    });

    it('should never contain slashes', () => {
      fc.assert(
        fc.property(safeString, safeString, (pkg, sub) => {
          const result = generateTagPrefix(pkg, sub);
          expect(result).not.toContain('/');
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should have consistent format', () => {
      fc.assert(
        fc.property(safeString, safeString, (pkg, sub) => {
          const result = generateTagPrefix(pkg, sub);
          // Should be: actions-{pkg}-{sub}
          const expected = `actions-${pkg}-${sub}`.replaceAll('/', '-');
          expect(result).toBe(expected);
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });
  });

  describe('generateVersioningRegex', () => {
    it('should generate a valid regex string', () => {
      fc.assert(
        fc.property(safeString, (prefix) => {
          const regexStr = generateVersioningRegex(prefix);
          try {
            new RegExp(regexStr);
            return true;
          } catch {
            return false;
          }
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should match a valid version string created from the prefix', () => {
      fc.assert(
        fc.property(safeString, fc.nat(), fc.nat(), fc.nat(), (prefix, major, minor, patch) => {
          const regexStr = generateVersioningRegex(prefix);
          const regex = new RegExp(regexStr);
          const versionString = `${prefix}-v${major}.${minor}.${patch}`;
          return regex.test(versionString);
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should capture major, minor, and patch groups', () => {
      fc.assert(
        fc.property(
          safeString,
          fc.nat({ max: 100 }),
          fc.nat({ max: 100 }),
          fc.nat({ max: 100 }),
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
        ),
        { numRuns: 30 },
      );
      expect(true).toBe(true);
    });

    it('should NOT match strings without the correct prefix', () => {
      fc.assert(
        fc.property(safeString, safeString, (prefix, wrongPrefix) => {
          // Skip if they're the same
          if (prefix === wrongPrefix) return true;

          const regexStr = generateVersioningRegex(prefix);
          const regex = new RegExp(regexStr);
          const versionString = `${wrongPrefix}-v1.2.3`;

          expect(regex.test(versionString)).toBe(false);
        }),
        { numRuns: 30 },
      );
      expect(true).toBe(true);
    });

    it('should NOT match versions without -v prefix', () => {
      fc.assert(
        fc.property(safeString, fc.nat(), fc.nat(), fc.nat(), (prefix, major, minor, patch) => {
          const regexStr = generateVersioningRegex(prefix);
          const regex = new RegExp(regexStr);
          // Missing the -v
          const invalidVersion = `${prefix}${major}.${minor}.${patch}`;
          expect(regex.test(invalidVersion)).toBe(false);
        }),
        { numRuns: 30 },
      );
      expect(true).toBe(true);
    });

    it('should handle complex prefixes with hyphens', () => {
      const prefix = 'actions-my-pkg-my-sub';
      const regexStr = generateVersioningRegex(prefix);
      const regex = new RegExp(regexStr);

      expect(regex.test(`${prefix}-v1.2.3`)).toBe(true);
      expect(regex.test(`${prefix}-v10.20.30`)).toBe(true);
      expect(regex.test('different-prefix-v1.2.3')).toBe(false);
    });
  });
});
