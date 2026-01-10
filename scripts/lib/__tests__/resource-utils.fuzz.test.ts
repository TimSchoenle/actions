import { describe, expect } from 'vitest';
import { test as fcTest, fc } from '@fast-check/vitest';
import { generateResourceKey, generateComponentName } from '../resource-utils';
import type { ResourceType } from '../resource-utils';

describe('resource-utils fuzzing', () => {
  const safePackageName = fc.stringMatching(/^[a-z0-9-]+$/);
  const safeSubName = fc.stringMatching(/^[a-z0-9-]+$/);
  const resourceType = fc.constantFrom<ResourceType>('action', 'workflow');

  describe('generateResourceKey', () => {
    fcTest.prop([resourceType, safePackageName, safeSubName])(
      'should generate correct key format',
      (type, pkg, sub) => {
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
      },
    );

    fcTest.prop([resourceType, safePackageName, safeSubName])(
      'should always start with actions or workflows',
      (type, pkg, sub) => {
        const key = generateResourceKey(type, pkg, sub);
        const startsWithActions = key.startsWith('actions/');
        const startsWithWorkflows = key.startsWith('workflows/');

        expect(startsWithActions || startsWithWorkflows).toBe(true);
      },
    );
  });

  describe('generateComponentName', () => {
    fcTest.prop([safePackageName, safeSubName])('should generate action component names correctly', (pkg, sub) => {
      const component = generateComponentName('action', pkg, sub);

      // Action format: actions-{packageName}-{subName}
      const expected = `actions-${pkg}-${sub}`;
      expect(component).toBe(expected);
      expect(component.endsWith('-meta')).toBe(false);
    });

    fcTest.prop([safePackageName, safeSubName])(
      'should generate workflow component names with -meta suffix',
      (pkg, sub) => {
        const component = generateComponentName('workflow', pkg, sub);

        // Workflow format: workflows-{packageName}-{subName}-meta
        const expected = `workflows-${pkg}-${sub}-meta`;
        expect(component).toBe(expected);
        expect(component.endsWith('-meta')).toBe(true);
      },
    );

    fcTest.prop([safePackageName, safeSubName])('should differentiate action and workflow components', (pkg, sub) => {
      const actionComponent = generateComponentName('action', pkg, sub);
      const workflowComponent = generateComponentName('workflow', pkg, sub);

      // They should always be different (workflow has -meta)
      expect(actionComponent).not.toBe(workflowComponent);
      expect(workflowComponent.endsWith('-meta')).toBe(true);
      expect(actionComponent.endsWith('-meta')).toBe(false);
    });
  });
});
