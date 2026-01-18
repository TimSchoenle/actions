import { describe, expect, it } from 'vitest';
import { fc } from '@fast-check/vitest';
import { deriveWorkflowMetadata } from '../workflow-parser';
import { deriveActionMetadata } from '../action-parser';

const safeString = fc.stringMatching(/^[a-z0-9]+$/);
const versionString = fc.stringMatching(/^[0-9.]+$/);

describe('parsers fuzzing', () => {
  describe('deriveWorkflowMetadata', () => {
    it('should return null if path does not start with workflows/', () => {
      fc.assert(
        fc.property(fc.string(), fc.string(), fc.string(), (dir, ver, repo) => {
          if (dir.startsWith('workflows/') || dir.startsWith('workflows\\')) return true;
          const result = deriveWorkflowMetadata(dir, ver, repo);
          return result === null;
        }),
      );
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
      );
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
      );
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
      );
    });

    it('should handle single-level workflow paths', () => {
      fc.assert(
        fc.property(safeString, versionString, safeString, (pkg, ver, repo) => {
          const dir = `workflows/${pkg}`;
          const result = deriveWorkflowMetadata(dir, ver, repo);

          // Should return null for insufficient path depth
          expect(result).toBeNull();
        }),
      );
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
      );
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
      );
    });

    it('should preserve provided name', () => {
      fc.assert(
        fc.property(safeString, safeString, versionString, fc.string({ minLength: 1 }), (repoId, pkg, ver, name) => {
          const dir = `actions/${pkg}`;
          const result = deriveActionMetadata(dir, ver, repoId, name);

          expect(result.name).toBe(name);
        }),
      );
    });

    it('should include description when provided', () => {
      fc.assert(
        fc.property(safeString, versionString, fc.string(), fc.string(), (pkg, ver, name, desc) => {
          const result = deriveActionMetadata(`actions/${pkg}`, ver, 'repo', name, desc);
          expect(result.description).toBe(desc);
        }),
      );
    });
  });
});
