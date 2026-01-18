import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPackages,
  getSubResources,
  selectPackage,
  registerResourceInReleasePlease,
  removeResourceFromReleasePlease,
  createVerifyWorkflow,
  removeVerifyWorkflow,
} from '../resource-utils';
import { Sys } from '../utils';

// Mock utils
vi.mock('../utils', () => ({
  Sys: {
    exists: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    mkdir: vi.fn(),
    file: vi.fn(),
    write: vi.fn(),
    rm: vi.fn(),
  },
  ACTIONS_DIR: 'E:\\actions\\actions',
  ROOT_DIR: 'E:\\actions',
  START_VERSION: '1.0.0',
  capitalize: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
  createFromTemplate: vi.fn(),
}));

// Mock prompts
vi.mock('@inquirer/prompts', () => ({
  search: vi.fn(),
  input: vi.fn(),
}));

import { createFromTemplate } from '../utils';

describe('resource-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPackages', () => {
    it('should return list of package directories for actions', async () => {
      (Sys.exists as any).mockReturnValue(true);
      (Sys.readdir as any).mockReturnValue(['pkg1', 'file.txt']);
      (Sys.stat as any).mockImplementation(
        (path: string) =>
          ({
            isDirectory: () => !path.includes('.txt'),
          }) as any,
      );

      const packages = await getPackages('action');
      expect(packages).toEqual(['pkg1']);
      expect(Sys.readdir).toHaveBeenCalledWith(expect.stringContaining('actions'));
    });

    it('should return list of package directories for workflows', async () => {
      (Sys.exists as any).mockReturnValue(true);
      (Sys.readdir as any).mockReturnValue(['pkg1', 'file.txt']);
      (Sys.stat as any).mockImplementation(
        (path: string) =>
          ({
            isDirectory: () => !path.includes('.txt'),
          }) as any,
      );

      const packages = await getPackages('workflow');
      expect(packages).toEqual(['pkg1']);
      expect(Sys.readdir).toHaveBeenCalledWith(expect.stringContaining('workflows'));
    });
  });

  describe('getSubResources', () => {
    it('should return list of sub-resources', async () => {
      (Sys.exists as any).mockReturnValue(true);
      (Sys.readdir as any).mockReturnValue(['sub1', 'file.txt']);
      (Sys.stat as any).mockImplementation(
        (path: string) =>
          ({
            isDirectory: () => !path.includes('.txt'),
          }) as any,
      );

      const subs = await getSubResources('action', 'pkg1');
      expect(subs).toEqual(['sub1']);
    });
  });

  describe('registerResourceInReleasePlease', () => {
    it('should register action with standard naming', async () => {
      (Sys.file as any).mockReturnValue({
        json: vi.fn().mockResolvedValue({ packages: {} }),
      } as any);

      await registerResourceInReleasePlease('action', 'pkg', 'sub');

      expect(Sys.write).toHaveBeenCalledTimes(2); // Config and Manifest
      // Verify Config write
      const configWrite = (Sys.write as any).mock.calls[0];
      const config = JSON.parse(configWrite[1] as string);
      expect(config.packages['actions/pkg/sub'].component).toBe('actions-pkg-sub');
    });

    it('should register workflow with meta suffix', async () => {
      (Sys.file as any).mockReturnValue({
        json: vi.fn().mockResolvedValue({ packages: {} }),
      } as any);

      await registerResourceInReleasePlease('workflow', 'pkg', 'sub');

      expect(Sys.write).toHaveBeenCalledTimes(2);
      const configWrite = (Sys.write as any).mock.calls[0];
      const config = JSON.parse(configWrite[1] as string);
      expect(config.packages['workflows/pkg/sub'].component).toBe('workflows-pkg-sub-meta');
    });
  });

  describe('createVerifyWorkflow', () => {
    it('should create verify workflow for action', async () => {
      await createVerifyWorkflow('action', 'pkg', 'sub');
      expect(createFromTemplate).toHaveBeenCalledWith(
        'action/verify-workflow.yaml',
        expect.stringContaining('verify-action-pkg-sub.yaml'),
        expect.anything(),
      );
    });

    it('should create verify workflow for workflow', async () => {
      await createVerifyWorkflow('workflow', 'pkg', 'sub');
      expect(createFromTemplate).toHaveBeenCalledWith(
        'workflow/verify-workflow.yaml',
        expect.stringContaining('verify-workflow-pkg-sub.yaml'),
        expect.anything(),
      );
    });
  });
});
