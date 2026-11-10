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

    it('asks origin when the tag is not in the local repository, preferring the peeled commit', async () => {
      const tagObject = '1111111111111111111111111111111111111111';
      const commit = '2222222222222222222222222222222222222222';
      vi.mocked(Sys.exec)
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce(
          `${tagObject}\trefs/tags/actions-example-v1.0.3\n${commit}\trefs/tags/actions-example-v1.0.3^{}\n`,
        );

      expect(await getTagCommitSha('actions-example-v1.0.3')).toBe(commit);
      expect(vi.mocked(Sys.exec).mock.calls[1][0]).toBe(
        'git ls-remote --tags origin refs/tags/actions-example-v1.0.3 refs/tags/actions-example-v1.0.3^{}',
      );
    });

    it('takes a lightweight tag on origin as its commit', async () => {
      const commit = '3333333333333333333333333333333333333333';
      vi.mocked(Sys.exec)
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce(`${commit}\trefs/tags/actions-example-v1.0.4\n`);

      expect(await getTagCommitSha('actions-example-v1.0.4')).toBe(commit);
    });

    it('does not look up a name that is not a plain tag name', async () => {
      expect(await getTagCommitSha('--upload-pack=evil')).toBeNull();
      expect(await getTagCommitSha('main^{commit}')).toBeNull();
      expect(Sys.exec).not.toHaveBeenCalled();
    });
  });
});
