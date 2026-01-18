import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RenovateConfigManager } from '../renovate-config';
import { Sys } from '../utils';

// Mock utils module partially
import type * as UtilsTypes from '../utils';
vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof UtilsTypes>('../utils');
  return {
    ...actual,
    Sys: {
      exists: vi.fn(),
      file: vi.fn(),
      write: vi.fn(),
      rm: vi.fn(),
      mkdir: vi.fn(),
      stat: vi.fn(),
      readdir: vi.fn(),
      exec: vi.fn(),
    },
    // We mock getRepoName to avoid git calls
    getRepoName: vi.fn(),
  };
});

import { getRepoName } from '../utils';

describe('RenovateConfigManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mock returns
    vi.mocked(getRepoName).mockResolvedValue('user/repo');
  });

  describe('readConfig', () => {
    it('should read and parse JSON config', async () => {
      vi.mocked(Sys.exists).mockReturnValue(true);
      vi.mocked(Sys.file).mockReturnValue({
        text: vi.fn().mockResolvedValue('{"packageRules": []}'),
      } as unknown as ReturnType<typeof Sys.file>);

      const config = await RenovateConfigManager.readConfig();
      expect(config).toEqual({ packageRules: [] });
    });

    it('should throw if config missing', async () => {
      vi.mocked(Sys.exists).mockReturnValue(false);
      await expect(RenovateConfigManager.readConfig()).rejects.toThrow('Renovate config not found');
    });
  });

  describe('addPackageRule', () => {
    it('should add a new package rule', async () => {
      // Setup readConfig mocks
      vi.mocked(Sys.exists).mockReturnValue(true);
      vi.mocked(Sys.file).mockReturnValue({
        text: vi.fn().mockResolvedValue('{"packageRules": []}'),
      } as unknown as ReturnType<typeof Sys.file>);

      await RenovateConfigManager.addPackageRule('pkg', 'sub');

      expect(Sys.write).toHaveBeenCalled();
      const writeCall = vi.mocked(Sys.write).mock.calls[0];
      const writtenContent = JSON.parse(writeCall[1] as string);

      expect(writtenContent.packageRules).toHaveLength(1);
      expect(writtenContent.packageRules[0]).toMatchObject({
        matchDepNames: ['user/repo/actions/pkg/sub'],
      });
    });

    it('should not add duplicate rule', async () => {
      // Setup readConfig with existing rule
      const existingRule = {
        description: 'Versioning for action pkg/sub',
        matchDepNames: ['user/repo/actions/pkg/sub'],
        versioning: 'regex:foo',
      };

      vi.mocked(Sys.exists).mockReturnValue(true);
      vi.mocked(Sys.file).mockReturnValue({
        text: vi.fn().mockResolvedValue(JSON.stringify({ packageRules: [existingRule] })),
      } as unknown as ReturnType<typeof Sys.file>);

      await RenovateConfigManager.addPackageRule('pkg', 'sub');

      expect(Sys.write).not.toHaveBeenCalled();
    });
  });

  describe('removePackageRule', () => {
    it('should remove existing rule', async () => {
      const existingRule = {
        description: 'Versioning for action pkg/sub',
        matchDepNames: ['user/repo/actions/pkg/sub'],
        versioning: 'regex:foo',
      };

      vi.mocked(Sys.exists).mockReturnValue(true);
      vi.mocked(Sys.file).mockReturnValue({
        text: vi.fn().mockResolvedValue(JSON.stringify({ packageRules: [existingRule] })),
      } as unknown as ReturnType<typeof Sys.file>);

      await RenovateConfigManager.removePackageRule('pkg', 'sub');

      expect(Sys.write).toHaveBeenCalled();
      const writeCall = vi.mocked(Sys.write).mock.calls[0];
      const writtenContent = JSON.parse(writeCall[1] as string);
      expect(writtenContent.packageRules).toHaveLength(0);
    });
  });
});
