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

    it('should offer the matching packages, plus a create entry only when creation is allowed', async () => {
      vi.mocked(Sys.exists).mockReturnValue(true);
      vi.mocked(Sys.readdir).mockReturnValue(['rust', 'bun']);
      vi.mocked(Sys.stat).mockReturnValue({ isDirectory: () => true } as unknown as ReturnType<typeof Sys.stat>);
      vi.mocked(search).mockResolvedValue('rust');

      await actionUtils.selectPackage(false);
      await actionUtils.selectPackage(true);

      type Source = (term: string | undefined) => Promise<{ name: string; value: string }[]>;
      const [withoutCreate, withCreate] = vi.mocked(search).mock.calls.map(([config]) => config.source as Source);

      expect(await withoutCreate('ru')).toEqual([{ name: 'rust', value: 'rust' }]);
      expect(await withoutCreate(undefined)).toHaveLength(2);
      expect((await withCreate('ru')).map(({ value }) => value)).toEqual(['rust', '__NEW__']);
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
      vi.mocked(Sys.exists).mockReturnValue(true);
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

      expect(JSON.parse(configWrite[1] as string).packages['actions/pkg/sub']).toEqual({
        'release-type': 'simple',
        component: 'actions-pkg-sub',
        'include-component-in-tag': true,
      });
      expect(JSON.parse(manifestWrite[1] as string)['actions/pkg/sub']).toBe('1.0.0');
    });

    it('should create config and manifest when they are missing', async () => {
      vi.mocked(Sys.exists).mockReturnValue(false);
      const json = vi.fn();
      vi.mocked(Sys.file).mockReturnValue({ json } as unknown as ReturnType<typeof Sys.file>);

      await actionUtils.registerActionInReleasePlease('pkg', 'sub');

      expect(json).not.toHaveBeenCalled();
      expect(Sys.write).toHaveBeenCalledTimes(2);
      expect(JSON.parse(vi.mocked(Sys.write).mock.calls[0][1] as string)).toEqual({
        packages: {
          'actions/pkg/sub': {
            'release-type': 'simple',
            component: 'actions-pkg-sub',
            'include-component-in-tag': true,
          },
        },
      });
      expect(JSON.parse(vi.mocked(Sys.write).mock.calls[1][1] as string)).toEqual({ 'actions/pkg/sub': '1.0.0' });
    });

    it('should not overwrite an existing config or manifest it cannot parse', async () => {
      vi.mocked(Sys.exists).mockReturnValue(true);
      vi.mocked(Sys.file).mockReturnValue({
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      } as unknown as ReturnType<typeof Sys.file>);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await actionUtils.registerActionInReleasePlease('pkg', 'sub');

      expect(Sys.write).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    });

    it('should handle write errors gracefully', async () => {
      vi.mocked(Sys.exists).mockReturnValue(true);
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
