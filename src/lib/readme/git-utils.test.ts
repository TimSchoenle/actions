import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRepoInfo } from './git-utils';
import { Sys } from '../utils';

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    Sys: {
      exec: vi.fn(),
    },
  };
});

describe('Git Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getRepoInfo', () => {
    it('should extract owner/repo from git config', async () => {
      vi.mocked(Sys.exec).mockResolvedValue('https://github.com/user/repo.git');
      const result = await getRepoInfo();
      expect(result).toBe('user/repo');
    });

    it('should throw if regex fails', async () => {
      vi.mocked(Sys.exec).mockResolvedValue('invalid-url');
      await expect(getRepoInfo()).rejects.toThrow('Could not parse git remote url');
    });

    it('should throw if exec throws', async () => {
      vi.mocked(Sys.exec).mockRejectedValue(new Error('git error'));
      await expect(getRepoInfo()).rejects.toThrow('Failed to get git remote url: Error: git error');
    });
  });
});
