import { describe, expect, it } from 'vitest';
import { fc } from '@fast-check/vitest';
import { deriveActionMetadata } from '../action-parser';

const safeString = fc.stringMatching(/^[a-z0-9]+$/);
const versionString = fc.stringMatching(/^[0-9.]+$/);

describe('parsers fuzzing', () => {
  describe('deriveActionMetadata', () => {
    it('should correctly derive category', () => {
      fc.assert(
        fc.property(safeString, safeString, versionString, fc.string(), (repoId, pkg, ver, name) => {
          const dir = `actions/${pkg}`;
          const result = deriveActionMetadata(dir, ver, ver, repoId, name);

          expect(result.category).toBe('Other');

          const dirDeep = `actions/${pkg}/sub`;
          const resultDeep = deriveActionMetadata(dirDeep, ver, ver, repoId, name);
          const expectedCategory = pkg.charAt(0).toUpperCase() + pkg.slice(1);
          expect(resultDeep.category).toBe(expectedCategory);
        }),
      );
    });

    it('should generate correct usage string format', () => {
      fc.assert(
        fc.property(safeString, safeString, versionString, fc.string(), (repoId, pkg, ver, name) => {
          const dir = `actions/${pkg}`;
          const result = deriveActionMetadata(dir, ver, ver, repoId, name);

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
          const result = deriveActionMetadata(dir, ver, ver, repoId, name);

          expect(result.name).toBe(name);
        }),
      );
    });

    it('should include description when provided', () => {
      fc.assert(
        fc.property(safeString, versionString, fc.string(), fc.string(), (pkg, ver, name, desc) => {
          const result = deriveActionMetadata(`actions/${pkg}`, ver, ver, 'repo', name, desc);
          expect(result.description).toBe(desc);
        }),
      );
    });
  });
});
