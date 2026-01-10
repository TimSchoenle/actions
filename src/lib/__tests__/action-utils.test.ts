import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as actionUtils from '../action-utils';
import { Sys } from '../utils';

// Mock utils
import type * as UtilsTypes from '../utils';
vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof UtilsTypes>();
  return {
    ...actual,
    Sys: {
      exists: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
      file: vi.fn(),
      write: vi.fn(),
      rm: vi.fn(),
    },
    createFromTemplate: vi.fn(),
  };
});

// Mock inquirer prompts
vi.mock('@inquirer/prompts', () => ({
  search: vi.fn(),
  input: vi.fn(),
}));

import { search, input } from '@inquirer/prompts';
import { createFromTemplate } from '../utils';

describe('action-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPackages', () => {
    it('should return list of package directories', async () => {
      vi.mocked(Sys.exists).mockReturnValue(true);
      vi.mocked(Sys.readdir).mockReturnValue(['pkg1', 'file.txt']);
      vi.mocked(Sys.stat).mockImplementation(
        (p) =>
          ({
            isDirectory: () => !p.endsWith('file.txt'),
          }) as unknown as ReturnType<typeof Sys.stat>,
      );

      const packages = await actionUtils.getPackages();
      expect(packages).toEqual(['pkg1']);
    });

    it('should return empty list if actions dir does not exist', async () => {
      vi.mocked(Sys.exists).mockReturnValue(false);
      const packages = await actionUtils.getPackages();
      expect(packages).toEqual([]);
    });
  });

  describe('getSubActions', () => {
    it('should return list of sub-actions', async () => {
      vi.mocked(Sys.exists).mockReturnValue(true);
      vi.mocked(Sys.readdir).mockReturnValue(['sub1', 'file.txt']);
      vi.mocked(Sys.stat).mockImplementation(
        (p) =>
          ({
            isDirectory: () => !p.endsWith('file.txt'),
          }) as unknown as ReturnType<typeof Sys.stat>,
      );

      const subActions = await actionUtils.getSubActions('pkg1');
      expect(subActions).toEqual(['sub1']);
    });

    it('should return empty list if package dir does not exist', async () => {
      vi.mocked(Sys.exists).mockReturnValue(false);
      const subActions = await actionUtils.getSubActions('pkg1');
      expect(subActions).toEqual([]);
    });
  });

  describe('selectPackage', () => {
    it('should select an existing package', async () => {
      // Correctly mock Sys to return packages
      vi.mocked(Sys.exists).mockReturnValue(true);
      vi.mocked(Sys.readdir).mockReturnValue(['pkg1', 'file.txt']);
      vi.mocked(Sys.stat).mockImplementation(
        (p) =>
          ({
            isDirectory: () => !p.endsWith('file.txt'),
          }) as unknown as ReturnType<typeof Sys.stat>,
      );

      vi.mocked(search).mockResolvedValue('pkg1');

      const pkg = await actionUtils.selectPackage();
      expect(pkg).toBe('pkg1');
    });

    it('should allow creating new package', async () => {
      vi.mocked(Sys.exists).mockReturnValue(true);
      vi.mocked(Sys.readdir).mockReturnValue(['pkg1']);
      vi.mocked(Sys.stat).mockReturnValue({ isDirectory: () => true } as unknown as ReturnType<typeof Sys.stat>);

      vi.mocked(search).mockResolvedValue('__NEW__');
      vi.mocked(input).mockResolvedValue('new-pkg');

      const pkg = await actionUtils.selectPackage(true);
      expect(pkg).toBe('new-pkg');
    });

    it('should throw if no packages found and creation not allowed', async () => {
      vi.mocked(Sys.exists).mockReturnValue(false);
      await expect(actionUtils.selectPackage(false)).rejects.toThrow('No packages found');
    });

    it('should prompt for new package if no packages found and creation allowed', async () => {
      vi.mocked(Sys.exists).mockReturnValue(false);
      vi.mocked(input).mockResolvedValue('new-pkg');
      const pkg = await actionUtils.selectPackage(true);
      expect(pkg).toBe('new-pkg');
    });
  });

  describe('registerActionInReleasePlease', () => {
    it('should update config and manifest', async () => {
      // Mock config file read
      vi.mocked(Sys.file)
        .mockReturnValueOnce({
          json: vi.fn().mockResolvedValue({ packages: {} }),
        } as unknown as ReturnType<typeof Sys.file>) // config
        .mockReturnValueOnce({
          json: vi.fn().mockResolvedValue({}),
        } as unknown as ReturnType<typeof Sys.file>); // manifest

      await actionUtils.registerActionInReleasePlease('pkg', 'sub');

      expect(Sys.write).toHaveBeenCalledTimes(2); // Config and Manifest

      const configWrite = vi.mocked(Sys.write).mock.calls[0];
      const manifestWrite = vi.mocked(Sys.write).mock.calls[1];

      expect(JSON.parse(configWrite[1] as string).packages['actions/pkg/sub']).toBeDefined();
      expect(JSON.parse(manifestWrite[1] as string)['actions/pkg/sub']).toBeDefined();
    });

    it('should handle missing config/manifest gracefully (create new)', async () => {
      vi.mocked(Sys.file).mockReturnValue({
        json: vi.fn().mockRejectedValue(new Error('File not found')),
      } as unknown as ReturnType<typeof Sys.file>);

      await actionUtils.registerActionInReleasePlease('pkg', 'sub');

      expect(Sys.write).toHaveBeenCalledTimes(2);
      // Expect empty objects to be populated
    });

    it('should handle write errors gracefully', async () => {
      vi.mocked(Sys.file).mockReturnValue({
        json: vi.fn().mockResolvedValue({}),
      } as unknown as ReturnType<typeof Sys.file>);
      vi.mocked(Sys.write).mockRejectedValue(new Error('Write failed'));

      // Should not throw, but log warning (which we can spy on console if strict)
      await expect(actionUtils.registerActionInReleasePlease('pkg', 'sub')).resolves.not.toThrow();
    });
  });

  describe('removeActionFromReleasePlease', () => {
    it('should remove action from config and manifest', async () => {
      vi.mocked(Sys.file)
        .mockReturnValueOnce({
          json: vi.fn().mockResolvedValue({ packages: { 'actions/pkg/sub': {} } }),
        } as unknown as ReturnType<typeof Sys.file>)
        .mockReturnValueOnce({
          json: vi.fn().mockResolvedValue({ 'actions/pkg/sub': '1.0.0' }),
        } as unknown as ReturnType<typeof Sys.file>);

      await actionUtils.removeActionFromReleasePlease('pkg', 'sub');

      expect(Sys.write).toHaveBeenCalledTimes(2);
      const configWrite = vi.mocked(Sys.write).mock.calls[0];
      const manifestWrite = vi.mocked(Sys.write).mock.calls[1];

      expect(JSON.parse(configWrite[1] as string).packages['actions/pkg/sub']).toBeUndefined();
      expect(JSON.parse(manifestWrite[1] as string)['actions/pkg/sub']).toBeUndefined();
    });

    it('should handle missing entries gracefully', async () => {
      vi.mocked(Sys.file).mockReturnValue({
        json: vi.fn().mockResolvedValue({ packages: {} }),
      } as unknown as ReturnType<typeof Sys.file>);

      await actionUtils.removeActionFromReleasePlease('pkg', 'sub');

      expect(Sys.write).not.toHaveBeenCalled();
    });
  });

  describe('createVerifyWorkflow', () => {
    it('should create workflow file from template', async () => {
      await actionUtils.createVerifyWorkflow('pkg', 'sub');
      expect(createFromTemplate).toHaveBeenCalledWith(
        'action/verify-workflow.yaml',
        expect.stringContaining('verify-action-pkg-sub.yaml'),
        expect.objectContaining({ packageName: 'pkg', subAction: 'sub' }),
      );
    });
  });

  describe('removeVerifyWorkflow', () => {
    it('should remove workflow file if exists', async () => {
      vi.mocked(Sys.exists).mockReturnValue(true);
      await actionUtils.removeVerifyWorkflow('pkg', 'sub');
      expect(Sys.rm).toHaveBeenCalledWith(expect.stringContaining('verify-action-pkg-sub.yaml'));
    });

    it('should not remove workflow file if not exists', async () => {
      vi.mocked(Sys.exists).mockReturnValue(false);
      await actionUtils.removeVerifyWorkflow('pkg', 'sub');
      expect(Sys.rm).not.toHaveBeenCalled();
    });
  });
});
