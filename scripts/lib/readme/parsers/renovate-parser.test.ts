import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RenovateParser } from './renovate-parser';
import { Sys } from '../../utils';
import * as GitUtils from '../git-utils';

vi.mock('../../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils')>();
  return {
    ...actual,
    Sys: {
      glob: vi.fn(),
      file: vi.fn(),
    },
  };
});

vi.mock('../git-utils', () => ({
  getRepoInfo: vi.fn(),
}));

describe('RenovateParser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse renovate configs', async () => {
    vi.mocked(GitUtils.getRepoInfo).mockResolvedValue('owner/repo');

    const mockScan = {
      scan: async function* () {
        yield 'configs/renovate/base.json';
        yield 'configs/renovate/ci.json';
      },
    };
    vi.mocked(Sys.glob).mockReturnValue(mockScan as unknown as ReturnType<typeof Sys.glob>);

    vi.mocked(Sys.file).mockImplementation(
      (path: string) =>
        ({
          text: async () => {
            if (path.includes('base.json')) return JSON.stringify({ description: 'Base Config' });
            if (path.includes('ci.json')) return JSON.stringify({ description: 'CI Config' });
            return '{}';
          },
          exists: async () => true,
          json: async () => ({}),
          write: async () => {},
        }) as unknown as ReturnType<typeof Sys.file>,
    );

    const parser = new RenovateParser();
    const items = await parser.parse();

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      name: 'base',
      description: 'Base Config',
      usage: '`"extends": ["github>owner/repo//configs/renovate/base"]`',
      category: 'Renovate',
      path: 'configs/renovate/base.json',
    });
    expect(items[1]).toEqual({
      name: 'ci',
      description: 'CI Config',
      usage: '`"extends": ["github>owner/repo//configs/renovate/ci"]`',
      category: 'Renovate',
      path: 'configs/renovate/ci.json',
    });
  });

  it('should use default description if missing', async () => {
    vi.mocked(GitUtils.getRepoInfo).mockResolvedValue('owner/repo');

    const mockScan = {
      scan: async function* () {
        yield 'configs/renovate/test.json';
      },
    };
    vi.mocked(Sys.glob).mockReturnValue(mockScan as unknown as ReturnType<typeof Sys.glob>);
    vi.mocked(Sys.file).mockImplementation(
      () =>
        ({
          text: async () => '{}',
          exists: async () => true,
          json: async () => ({}),
          write: async () => {},
        }) as unknown as ReturnType<typeof Sys.file>,
    );

    const parser = new RenovateParser();
    const items = await parser.parse();

    expect(items[0].description).toBe('No description provided.');
  });
});
