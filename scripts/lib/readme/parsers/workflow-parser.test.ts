import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowParser } from './workflow-parser';
import { Sys } from '../../utils';
import * as ReadmeUtils from '../utils';
import * as GitUtils from '../git-utils';

// Mock Sys
vi.mock('../../utils', () => {
  return {
    ROOT_DIR: '/mock/root',
    Sys: {
      glob: vi.fn(),
      file: vi.fn(),
    },
  };
});

// Mock ReadmeUtils
vi.mock('../utils', () => ({
  getManifestVersions: vi.fn(),
  getReleaseComponent: vi.fn(),
}));

// Mock GitUtils
vi.mock('../git-utils', () => ({
  getRepoInfo: vi.fn(),
}));

describe('WorkflowParser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse workflows with valid versions and derived clean structure', async () => {
    // Mock Repo Info
    (GitUtils.getRepoInfo as any).mockResolvedValue('owner/repo');
    // Mock Manifest
    (ReadmeUtils.getManifestVersions as any).mockResolvedValue({
      'workflows/common/test2': '2.5.0',
    });

    // Mock Glob
    const mockScan = {
      scan: async function* () {
        yield 'workflows/common/test2/workflow.yaml';
      },
    };
    (Sys.glob as any).mockReturnValue(mockScan);

    // Mock File Read
    (Sys.file as any).mockImplementation(() => ({
      text: async () => 'name: Common Test Workflow\ndescription: Reusable logic',
      exists: async () => true,
    }));

    const parser = new WorkflowParser();
    const items = await parser.parse();

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      name: 'Common Test Workflow', // From YAML
      description: 'Reusable logic', // From YAML
      version: 'workflows-common-test2-v2.5.0', // Derived
      usage: '`uses: owner/repo/.github/workflows/common-test2.yaml@workflows-common-test2-v2.5.0`', // Derived logic check
      category: 'Common',
      path: 'workflows/common/test2',
    });
  });

  it('should fallback to component name if YAML name is missing', async () => {
    (GitUtils.getRepoInfo as any).mockResolvedValue('owner/repo');
    (ReadmeUtils.getManifestVersions as any).mockResolvedValue({
      'workflows/common/simple': '1.0.0',
    });

    const mockScan = {
      scan: async function* () {
        yield 'workflows/common/simple/workflow.yaml';
      },
    };
    (Sys.glob as any).mockReturnValue(mockScan);

    (Sys.file as any).mockImplementation(() => ({
      text: async () => 'description: Just description',
      exists: async () => true,
    }));

    const parser = new WorkflowParser();
    const items = await parser.parse();

    expect(items[0].name).toBe('common-simple'); // Fallback from path
  });

  it('should skip workflows not in manifest', async () => {
    (GitUtils.getRepoInfo as any).mockResolvedValue('owner/repo');
    (ReadmeUtils.getManifestVersions as any).mockResolvedValue({}); // Empty manifest

    const mockScan = {
      scan: async function* () {
        yield 'workflows/common/ghost/workflow.yaml';
      },
    };
    (Sys.glob as any).mockReturnValue(mockScan);
    (Sys.file as any).mockImplementation(() => ({
      text: async () => 'name: Ghost',
    }));

    const parser = new WorkflowParser();
    const items = await parser.parse();

    expect(items).toHaveLength(0);
  });
});
