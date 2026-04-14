import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getManifestVersions, getReleaseComponent, getTagCommitSha } from './utils';
import { Sys } from '../utils';

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    Sys: {
      exec: vi.fn(),
      file: vi.fn(),
    },
  };
});

describe('Readme Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getManifestVersions', () => {
    it('should return empty object if file does not exist', async () => {
      vi.mocked(Sys.file).mockReturnValue({
        exists: async () => false,
        json: async () => ({}),
        text: async () => '',
        write: async () => {},
      } as unknown as ReturnType<typeof Sys.file>);
      const result = await getManifestVersions();
      expect(result).toEqual({});
    });

    it('should return parsed json', async () => {
      vi.mocked(Sys.file).mockReturnValue({
        exists: async () => true,
        json: async () => ({ pkg: '1.0.0' }),
        text: async () => '',
        write: async () => {},
      } as unknown as ReturnType<typeof Sys.file>);
      const result = await getManifestVersions();
      expect(result).toEqual({ pkg: '1.0.0' });
    });

    it('should return empty object if parse fails', async () => {
      vi.mocked(Sys.file).mockReturnValue({
        exists: async () => true,
        json: async () => {
          throw new Error('fail');
        },
        text: async () => '',
        write: async () => {},
      } as unknown as ReturnType<typeof Sys.file>);
      const result = await getManifestVersions();
      expect(result).toEqual({});
    });
  });

  describe('getReleaseComponent', () => {
    it('should return component name from config', async () => {
      vi.mocked(Sys.file).mockReturnValue({
        exists: async () => true,
        json: async () => ({ packages: { dir: { component: 'comp' } } }),
        text: async () => '',
        write: async () => {},
      } as unknown as ReturnType<typeof Sys.file>);
      const result = await getReleaseComponent('dir');
      expect(result).toBe('comp');
    });

    it('should return null if file missing', async () => {
      vi.mocked(Sys.file).mockReturnValue({
        exists: async () => false,
        json: async () => ({}),
        text: async () => '',
        write: async () => {},
      } as unknown as ReturnType<typeof Sys.file>);
      const result = await getReleaseComponent('dir');
      expect(result).toBeNull();
    });
  });

  describe('getTagCommitSha', () => {
    it('should return commit sha when git lookup succeeds', async () => {
      vi.mocked(Sys.exec).mockResolvedValue('0123456789abcdef0123456789abcdef01234567\n');
      const result = await getTagCommitSha('actions-example-v1.0.0');
      expect(result).toBe('0123456789abcdef0123456789abcdef01234567');
    });

    it('should return null for invalid sha output', async () => {
      vi.mocked(Sys.exec).mockResolvedValue('not-a-sha');
      const result = await getTagCommitSha('actions-example-v1.0.1');
      expect(result).toBeNull();
    });

    it('should return null when git command fails', async () => {
      vi.mocked(Sys.exec).mockRejectedValue(new Error('git failed'));
      const result = await getTagCommitSha('actions-example-v1.0.2');
      expect(result).toBeNull();
    });
  });
});
