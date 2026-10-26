import { describe, expect, it } from 'vitest';
import { fc } from '@fast-check/vitest';
import { generateActionKey, generateComponentName } from '../action-utils';

describe('action-utils fuzzing', () => {
  const safePackageName = fc.stringMatching(/^[a-z0-9-]+$/);
  const safeSubName = fc.stringMatching(/^[a-z0-9-]+$/);

  describe('generateActionKey', () => {
    it('should generate correct key format', () => {
      fc.assert(
        fc.property(safePackageName, safeSubName, (pkg, sub) => {
          const key = generateActionKey(pkg, sub);

          // Key format: actions/{packageName}/{subAction}
          expect(key).toBe(`actions/${pkg}/${sub}`);

          // Verify structure
          const parts = key.split('/');
          expect(parts.length).toBe(3);
          expect(parts[0]).toBe('actions');
          expect(parts[1]).toBe(pkg);
          expect(parts[2]).toBe(sub);
        }),
      );
    });
  });

  describe('generateComponentName', () => {
    it('should generate action component names correctly', () => {
      fc.assert(
        fc.property(safePackageName, safeSubName, (pkg, sub) => {
          // Component format: actions-{packageName}-{subAction}
          expect(generateComponentName(pkg, sub)).toBe(`actions-${pkg}-${sub}`);
        }),
      );
    });

    it('should match the release-please package key with its slashes turned into hyphens', () => {
      fc.assert(
        fc.property(safePackageName, safeSubName, (pkg, sub) => {
          expect(generateComponentName(pkg, sub)).toBe(generateActionKey(pkg, sub).replaceAll('/', '-'));
        }),
      );
    });
  });
});
