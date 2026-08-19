import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GithubConfigParser, parseGithubConfig } from '../github-config-parser';
import { Sys } from '../../../utils';

vi.mock('../../../utils', async () => {
  const actual = await vi.importActual<typeof import('../../../utils')>('../../../utils');
  return {
    ...actual,
    Sys: {
      ...actual.Sys,
      glob: vi.fn(),
      file: vi.fn(),
    },
  };
});

/** Ruleset names deliberately do not sort the same way as their file names. */
const RULESETS: Record<string, string> = {
  'configs/github-rulesets/branch-default_default-rules.json': 'Default Branch: Default Protection Rules',
  'configs/github-rulesets/branch-renovate_only-allow-trusted-bots.json': 'Renovate Branches: Trusted Bots Only',
  'configs/github-rulesets/release-tags_only-allow-release-bot.json':
    'Release Tags: Only Allow Automatic Release Manager Bot',
};

/** Stands in for a directory read that hands the files over in `order`. */
function mockDirectoryRead(order: readonly string[]) {
  vi.mocked(Sys.glob).mockReturnValue({
    scan: async function* () {
      yield* order;
    },
  } as unknown as ReturnType<typeof Sys.glob>);

  vi.mocked(Sys.file).mockImplementation((filePath: string) => {
    // The parser joins with `ROOT_DIR`, so match on the base name and stay separator-agnostic.
    const key = Object.keys(RULESETS).find((candidate) => filePath.endsWith(candidate.split('/').at(-1)!));
    return {
      text: async () => JSON.stringify({ name: key ? RULESETS[key] : 'Unknown', description: 'A description.' }),
    } as unknown as ReturnType<typeof Sys.file>;
  });
}

describe('GithubConfigParser', () => {
  describe('parseGithubConfig', () => {
    it('should parse valid JSON with name and description', () => {
      const content = JSON.stringify({ name: 'My Config', description: 'My Description' });
      const result = parseGithubConfig(content, 'path/to/config.json');
      expect(result).toEqual({
        name: 'My Config',
        description: 'My Description',
        usage: '',
        category: 'GitHub',
        path: 'path/to/config.json',
      });
    });

    it('should use filename when name is missing', () => {
      const content = JSON.stringify({ description: 'My Description' });
      const result = parseGithubConfig(content, 'path/to/my-config.json');
      expect(result).toEqual({
        name: 'my-config',
        description: 'My Description',
        usage: '',
        category: 'GitHub',
        path: 'path/to/my-config.json',
      });
    });

    it('should use empty description when missing', () => {
      const content = JSON.stringify({ name: 'My Config' });
      const result = parseGithubConfig(content, 'path/to/config.json');
      expect(result?.description).toBe('');
    });

    it('should return null for invalid JSON', () => {
      const result = parseGithubConfig('invalid-json', 'path/to/config.json');
      expect(result).toBeNull();
    });
  });

  describe('parse', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should sort rulesets by name rather than by directory-read order', async () => {
      mockDirectoryRead([
        'configs/github-rulesets/release-tags_only-allow-release-bot.json',
        'configs/github-rulesets/branch-renovate_only-allow-trusted-bots.json',
        'configs/github-rulesets/branch-default_default-rules.json',
      ]);

      const items = await new GithubConfigParser().parse();

      expect(items.map((item) => item.name)).toEqual([
        'Default Branch: Default Protection Rules',
        'Release Tags: Only Allow Automatic Release Manager Bot',
        'Renovate Branches: Trusted Bots Only',
      ]);
    });

    it('should produce the same order for every directory-read order', async () => {
      const files = Object.keys(RULESETS);
      const orders = [files, files.toReversed(), [files[1], files[2], files[0]], [files[2], files[0], files[1]]];

      const results: string[][] = [];
      for (const order of orders) {
        mockDirectoryRead(order);
        results.push((await new GithubConfigParser().parse()).map((item) => item.path));
      }

      for (const result of results) {
        expect(result).toEqual(results[0]);
      }
    });
  });
});
