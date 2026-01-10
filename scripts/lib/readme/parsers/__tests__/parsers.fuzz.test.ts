import { describe, expect } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { deriveWorkflowMetadata } from '../workflow-parser';
import { deriveActionMetadata } from '../action-parser';

const safeString = fc.stringMatching(/^[a-z0-9]+$/);
const versionString = fc.stringMatching(/^[0-9.]+$/);

describe('parsers fuzzing', () => {
  describe('deriveWorkflowMetadata', () => {
    test.prop([fc.string(), fc.string(), fc.string()])(
      'should return null if path does not start with workflows/',
      (dir, ver, repo) => {
        if (dir.startsWith('workflows/') || dir.startsWith('workflows\\')) return true;
        const result = deriveWorkflowMetadata(dir, ver, repo);
        return result === null;
      },
    );

    test.prop([safeString, safeString, safeString, versionString])(
      'should correctly derive metadata for valid paths',
      (repoId, pkg, sub, ver) => {
        const dir = `workflows/${pkg}/${sub}`;
        const result = deriveWorkflowMetadata(dir, ver, repoId);

        if (!result) return false;

        expect(result.name).toBe(`${pkg}-${sub}`);
        expect(result.version).toBe(`workflows-${pkg}-${sub}-v${ver}`);
        expect(result.category).toBe(pkg.charAt(0).toUpperCase() + pkg.slice(1));
      },
    );

    test.prop([safeString, safeString, versionString, safeString])(
      'should handle path normalization with backslashes',
      (repoId, pkg, ver, sub) => {
        const dirWindows = `workflows\\${pkg}\\${sub}`;
        const dirUnix = `workflows/${pkg}/${sub}`;

        const resultWindows = deriveWorkflowMetadata(dirWindows, ver, repoId);
        const resultUnix = deriveWorkflowMetadata(dirUnix, ver, repoId);

        if (resultWindows && resultUnix) {
          expect(resultWindows.name).toBe(resultUnix.name);
          expect(resultWindows.version).toBe(resultUnix.version);
          expect(resultWindows.category).toBe(resultUnix.category);
        }
      },
    );

    test.prop([safeString, safeString, safeString, versionString])(
      'should generate correct usage string format',
      (repoId, pkg, sub, ver) => {
        const dir = `workflows/${pkg}/${sub}`;
        const result = deriveWorkflowMetadata(dir, ver, repoId);

        if (!result) return true;

        expect(result.usage).toContain('.github/workflows/');
        expect(result.usage).toContain('@');
        expect(result.usage).toContain(repoId);
      },
    );

    test.prop([safeString, versionString, safeString])(
      'should handle single-level workflow paths',
      (pkg, ver, repo) => {
        const dir = `workflows/${pkg}`;
        const result = deriveWorkflowMetadata(dir, ver, repo);

        // Should return null for insufficient path depth
        expect(result).toBeNull();
      },
    );
  });

  describe('deriveActionMetadata', () => {
    test.prop([safeString, safeString, versionString, fc.string()])(
      'should correctly derive category',
      (repoId, pkg, ver, name) => {
        const dir = `actions/${pkg}`;
        const result = deriveActionMetadata(dir, ver, repoId, name);

        expect(result.category).toBe('Other');

        const dirDeep = `actions/${pkg}/sub`;
        const resultDeep = deriveActionMetadata(dirDeep, ver, repoId, name);
        const expectedCategory = pkg.charAt(0).toUpperCase() + pkg.slice(1);
        expect(resultDeep.category).toBe(expectedCategory);
      },
    );

    test.prop([safeString, safeString, versionString, fc.string()])(
      'should generate correct usage string format',
      (repoId, pkg, ver, name) => {
        const dir = `actions/${pkg}`;
        const result = deriveActionMetadata(dir, ver, repoId, name);

        expect(result.usage).toContain('`uses:');
        expect(result.usage).toContain('@');
        expect(result.usage).toContain(repoId);
        expect(result.usage).toContain(ver);
      },
    );

    test.prop([safeString, safeString, versionString, fc.string({ minLength: 1 })])(
      'should preserve provided name',
      (repoId, pkg, ver, name) => {
        const dir = `actions/${pkg}`;
        const result = deriveActionMetadata(dir, ver, repoId, name);

        expect(result.name).toBe(name);
      },
    );

    test.prop([safeString, versionString, fc.string(), fc.string()])(
      'should include description when provided',
      (pkg, ver, name, desc) => {
        const result = deriveActionMetadata(`actions/${pkg}`, ver, 'repo', name, desc);
        expect(result.description).toBe(desc);
      },
    );
  });
});
