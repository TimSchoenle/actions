import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckstyleParser, parseCheckstyleMeta } from '../checkstyle-parser';
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

describe('CheckstyleParser', () => {
  describe('parseCheckstyleMeta', () => {
    it('should parse valid JSON with name and description', () => {
      const content = JSON.stringify({ name: 'Strict', description: 'A strict ruleset.' });
      const result = parseCheckstyleMeta(content, 'configs/checkstyle/strict');
      expect(result).toEqual({
        name: 'Strict',
        description: 'A strict ruleset.',
        usage:
          "Vendor `configs/checkstyle/strict/` and `configs/checkstyle/_shared/` into your project, then point your build tool's config directory (Gradle `configDirectory`, Maven `config_loc`) at your copy of `configs/checkstyle/strict/`.",
        category: 'Checkstyle',
        path: 'configs/checkstyle/strict/checkstyle.xml',
      });
    });

    it('should use directory name when name is missing', () => {
      const content = JSON.stringify({ description: 'A ruleset.' });
      const result = parseCheckstyleMeta(content, 'configs/checkstyle/my-ruleset');
      expect(result?.name).toBe('my-ruleset');
    });

    it('should use default description when missing', () => {
      const content = JSON.stringify({ name: 'Default' });
      const result = parseCheckstyleMeta(content, 'configs/checkstyle/default');
      expect(result?.description).toBe('No description provided.');
    });

    it('should return null for invalid JSON', () => {
      const result = parseCheckstyleMeta('invalid-json', 'configs/checkstyle/default');
      expect(result).toBeNull();
    });
  });

  describe('parse', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should parse checkstyle rulesets from their meta.json', async () => {
      const mockScan = {
        scan: async function* () {
          yield 'configs/checkstyle/application/meta.json';
          yield 'configs/checkstyle/library/meta.json';
        },
      };
      vi.mocked(Sys.glob).mockReturnValue(mockScan as unknown as ReturnType<typeof Sys.glob>);

      vi.mocked(Sys.file).mockImplementation(
        (filePath: string) =>
          ({
            text: async () => {
              if (filePath.includes('library'))
                return JSON.stringify({ name: 'Library', description: 'Library rules.' });
              return JSON.stringify({ name: 'Application', description: 'Application rules.' });
            },
          }) as unknown as ReturnType<typeof Sys.file>,
      );

      const parser = new CheckstyleParser();
      const items = await parser.parse();

      expect(items.map((item) => item.name)).toEqual(['Application', 'Library']);
      expect(items.map((item) => item.path)).toEqual([
        'configs/checkstyle/application/checkstyle.xml',
        'configs/checkstyle/library/checkstyle.xml',
      ]);
    });

    it('should produce the same order for every directory-read order', async () => {
      vi.mocked(Sys.file).mockImplementation(
        () =>
          ({
            text: async () => JSON.stringify({ description: 'A description.' }),
          }) as unknown as ReturnType<typeof Sys.file>,
      );

      const files = [
        'configs/checkstyle/release-tags/meta.json',
        'configs/checkstyle/branch-renovate/meta.json',
        'configs/checkstyle/branch-default/meta.json',
      ];
      const orders = [files, files.toReversed(), [files[1], files[2], files[0]], [files[2], files[0], files[1]]];

      const results: string[][] = [];
      for (const order of orders) {
        vi.mocked(Sys.glob).mockReturnValue({
          scan: async function* () {
            yield* order;
          },
        } as unknown as ReturnType<typeof Sys.glob>);
        results.push((await new CheckstyleParser().parse()).map((item) => item.path));
      }

      for (const result of results) {
        expect(result).toEqual(results[0]);
      }
    });
  });
});
