import { describe, expect, it } from 'vitest';
import { fc } from '@fast-check/vitest';
import { generateResourceKey, generateComponentName } from '../resource-utils';
import type { ResourceType } from '../resource-utils';

describe('resource-utils fuzzing', () => {
  const safePackageName = fc.stringMatching(/^[a-z0-9-]+$/);
  const safeSubName = fc.stringMatching(/^[a-z0-9-]+$/);
  const resourceType = fc.constantFrom<ResourceType>('action', 'workflow');

  describe('generateResourceKey', () => {
    it('should generate correct key format', () => {
      fc.assert(
        fc.property(resourceType, safePackageName, safeSubName, (type, pkg, sub) => {
          const key = generateResourceKey(type, pkg, sub);

          // Key format: {type}s/{packageName}/{subName}
          const expected = `${type}s/${pkg}/${sub}`;
          expect(key).toBe(expected);

          // Verify structure
          const parts = key.split('/');
          expect(parts.length).toBe(3);
          expect(parts[0]).toBe(`${type}s`); // actions or workflows
          expect(parts[1]).toBe(pkg);
          expect(parts[2]).toBe(sub);
        }),
      );
    });

    it('should always start with actions or workflows', () => {
      fc.assert(
        fc.property(resourceType, safePackageName, safeSubName, (type, pkg, sub) => {
          const key = generateResourceKey(type, pkg, sub);
          const startsWithActions = key.startsWith('actions/');
          const startsWithWorkflows = key.startsWith('workflows/');

          expect(startsWithActions || startsWithWorkflows).toBe(true);
        }),
      );
    });
  });

  describe('generateComponentName', () => {
    it('should generate action component names correctly', () => {
      fc.assert(
        fc.property(safePackageName, safeSubName, (pkg, sub) => {
          const component = generateComponentName('action', pkg, sub);

          // Action format: actions-{packageName}-{subName}
          const expected = `actions-${pkg}-${sub}`;
          expect(component).toBe(expected);
          expect(component.endsWith('-meta')).toBe(false);
        }),
      );
    });

    it('should generate workflow component names with -meta suffix', () => {
      fc.assert(
        fc.property(safePackageName, safeSubName, (pkg, sub) => {
          const component = generateComponentName('workflow', pkg, sub);

          // Workflow format: workflows-{packageName}-{subName}-meta
          const expected = `workflows-${pkg}-${sub}-meta`;
          expect(component).toBe(expected);
          expect(component.endsWith('-meta')).toBe(true);
        }),
      );
    });

    it('should differentiate action and workflow components', () => {
      fc.assert(
        fc.property(safePackageName, safeSubName, (pkg, sub) => {
          const actionComponent = generateComponentName('action', pkg, sub);
          const workflowComponent = generateComponentName('workflow', pkg, sub);

          // They should always be different (workflow has -meta)
          expect(actionComponent).not.toBe(workflowComponent);
          expect(workflowComponent.endsWith('-meta')).toBe(true);
          expect(actionComponent.endsWith('-meta')).toBe(false);
        }),
      );
    });
  });
});
