import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionParser } from '../action-parser';
import { Sys } from '../../../utils';
import * as ReadmeUtils from '../../utils';
import * as GitUtils from '../../git-utils';

// Mock Sys
vi.mock('../../../utils', async () => {
  const actual = await vi.importActual<typeof import('../../utils')>('../../../utils');
  return {
    ...actual,
    Sys: {
      glob: vi.fn(),
      file: vi.fn(),
    },
  };
});

// Mock ReadmeUtils
vi.mock('../../utils', () => ({
  getManifestVersions: vi.fn(),
  getReleaseComponent: vi.fn(),
}));

// Mock GitUtils
vi.mock('../../git-utils', () => ({
  getRepoInfo: vi.fn(),
}));

describe('ActionParser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse actions with valid versions', async () => {
    // Mock Repo Info
    vi.mocked(GitUtils.getRepoInfo).mockResolvedValue('owner/repo');
    // Mock Manifest
    vi.mocked(ReadmeUtils.getManifestVersions).mockResolvedValue({
      'actions/pkg/sub': '1.0.0',
    });
    // Mock Release Component
    vi.mocked(ReadmeUtils.getReleaseComponent).mockImplementation(async (dir) => {
      if (dir.includes('actions/pkg/sub')) return 'pkg-sub';
      return null;
    });

    // Mock Glob
    const mockScan = {
      scan: async function* () {
        yield 'actions/pkg/sub/action.yml';
      },
    };
    vi.mocked(Sys.glob).mockReturnValue(mockScan as unknown as ReturnType<typeof Sys.glob>);

    // Mock File Read
    vi.mocked(Sys.file).mockImplementation(
      () =>
        ({
          text: async () => 'name: Test Action\ndescription: Test Desc',
          exists: async () => true,
          json: async () => ({}),
          write: async () => {},
        }) as unknown as ReturnType<typeof Sys.file>,
    );

    const parser = new ActionParser();
    const items = await parser.parse();

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      name: 'Test Action',
      description: 'Test Desc',
      version: 'pkg-sub-v1.0.0',
      usage: '`uses: owner/repo/actions/pkg/sub@pkg-sub-v1.0.0`',
      category: 'Pkg',
      path: 'actions/pkg/sub',
    });
  });

  it('should skip actions without version', async () => {
    vi.mocked(GitUtils.getRepoInfo).mockResolvedValue('owner/repo');
    vi.mocked(ReadmeUtils.getManifestVersions).mockResolvedValue({});
    vi.mocked(ReadmeUtils.getReleaseComponent).mockResolvedValue(null);

    const mockScan = {
      scan: async function* () {
        yield 'actions/pkg/no-version/action.yml';
      },
    };
    vi.mocked(Sys.glob).mockReturnValue(mockScan as unknown as ReturnType<typeof Sys.glob>);
    vi.mocked(Sys.file).mockImplementation(
      () =>
        ({
          text: async () => 'name: Test Action',
          exists: async () => true,
          json: async () => ({}),
          write: async () => {},
        }) as unknown as ReturnType<typeof Sys.file>,
    );

    const parser = new ActionParser();
    const items = await parser.parse();

    expect(items).toHaveLength(0);
  });
});
