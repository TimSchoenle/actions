import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveWorkflowMetadata } from '../workflow-parser';
import { deriveActionMetadata } from '../action-parser';

const safeString = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1 })
  .map((arr) => arr.join(''));
const versionString = fc
  .array(fc.constantFrom(...'0123456789.'.split('')), { minLength: 1 })
  .map((arr) => arr.join(''));

describe('parsers fuzzing', () => {
  describe('deriveWorkflowMetadata', () => {
    it('should return null if path does not start with workflows/', () => {
      fc.assert(
        fc.property(fc.string(), fc.string(), fc.string(), (dir, ver, repo) => {
          if (dir.startsWith('workflows/') || dir.startsWith('workflows\\')) return true;
          const result = deriveWorkflowMetadata(dir, ver, repo);
          return result === null;
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should correctly derive metadata for valid paths', () => {
      fc.assert(
        fc.property(safeString, safeString, safeString, versionString, (repoId, pkg, sub, ver) => {
          const dir = `workflows/${pkg}/${sub}`;
          const result = deriveWorkflowMetadata(dir, ver, repoId);

          if (!result) return false;

          expect(result.name).toBe(`${pkg}-${sub}`);
          expect(result.version).toBe(`workflows-${pkg}-${sub}-v${ver}`);
          expect(result.category).toBe(pkg.charAt(0).toUpperCase() + pkg.slice(1));
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should handle path normalization with backslashes', () => {
      fc.assert(
        fc.property(safeString, safeString, versionString, safeString, (repoId, pkg, ver, sub) => {
          const dirWindows = `workflows\\${pkg}\\${sub}`;
          const dirUnix = `workflows/${pkg}/${sub}`;

          const resultWindows = deriveWorkflowMetadata(dirWindows, ver, repoId);
          const resultUnix = deriveWorkflowMetadata(dirUnix, ver, repoId);

          if (resultWindows && resultUnix) {
            expect(resultWindows.name).toBe(resultUnix.name);
            expect(resultWindows.version).toBe(resultUnix.version);
            expect(resultWindows.category).toBe(resultUnix.category);
          }
        }),
        { numRuns: 30 },
      );
      expect(true).toBe(true);
    });

    it('should generate correct usage string format', () => {
      fc.assert(
        fc.property(safeString, safeString, safeString, versionString, (repoId, pkg, sub, ver) => {
          const dir = `workflows/${pkg}/${sub}`;
          const result = deriveWorkflowMetadata(dir, ver, repoId);

          if (!result) return true;

          expect(result.usage).toContain('.github/workflows/');
          expect(result.usage).toContain('@');
          expect(result.usage).toContain(repoId);
        }),
        { numRuns: 30 },
      );
      expect(true).toBe(true);
    });

    it('should handle single-level workflow paths', () => {
      fc.assert(
        fc.property(safeString, versionString, safeString, (pkg, ver, repo) => {
          const dir = `workflows/${pkg}`;
          const result = deriveWorkflowMetadata(dir, ver, repo);

          // Should return null for insufficient path depth
          expect(result).toBeNull();
        }),
        { numRuns: 20 },
      );
      expect(true).toBe(true);
    });
  });

  describe('deriveActionMetadata', () => {
    it('should correctly derive category', () => {
      fc.assert(
        fc.property(safeString, safeString, versionString, fc.string(), (repoId, pkg, ver, name) => {
          const dir = `actions/${pkg}`;
          const result = deriveActionMetadata(dir, ver, repoId, name);

          expect(result.category).toBe('Other');

          const dirDeep = `actions/${pkg}/sub`;
          const resultDeep = deriveActionMetadata(dirDeep, ver, repoId, name);
          const expectedCategory = pkg.charAt(0).toUpperCase() + pkg.slice(1);
          expect(resultDeep.category).toBe(expectedCategory);
        }),
        { numRuns: 50 },
      );
      expect(true).toBe(true);
    });

    it('should generate correct usage string format', () => {
      fc.assert(
        fc.property(safeString, safeString, versionString, fc.string(), (repoId, pkg, ver, name) => {
          const dir = `actions/${pkg}`;
          const result = deriveActionMetadata(dir, ver, repoId, name);

          expect(result.usage).toContain('`uses:');
          expect(result.usage).toContain('@');
          expect(result.usage).toContain(repoId);
          expect(result.usage).toContain(ver);
        }),
        { numRuns: 30 },
      );
      expect(true).toBe(true);
    });

    it('should preserve provided name', () => {
      fc.assert(
        fc.property(safeString, safeString, versionString, fc.string({ minLength: 1 }), (repoId, pkg, ver, name) => {
          const dir = `actions/${pkg}`;
          const result = deriveActionMetadata(dir, ver, repoId, name);

          expect(result.name).toBe(name);
        }),
        { numRuns: 30 },
      );
      expect(true).toBe(true);
    });

    it('should handle empty description', () => {
      const result = deriveActionMetadata('actions/pkg', '1.0', 'repo', 'name');
      expect(result.description).toBe('');
    });

    it('should include description when provided', () => {
      fc.assert(
        fc.property(safeString, versionString, fc.string(), fc.string(), (pkg, ver, name, desc) => {
          const result = deriveActionMetadata(`actions/${pkg}`, ver, 'repo', name, desc);
          expect(result.description).toBe(desc);
        }),
        { numRuns: 30 },
      );
      expect(true).toBe(true);
    });
  });
});
