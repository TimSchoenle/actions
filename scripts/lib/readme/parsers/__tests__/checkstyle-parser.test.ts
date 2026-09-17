import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckstyleParser, parseCheckstyleMeta } from '../checkstyle-parser';
import { Sys } from '../../../utils';
import * as ReadmeUtils from '../../utils';
import * as GitUtils from '../../git-utils';

vi.mock('../../../utils', () => ({
  ROOT_DIR: '/mock/root',
  Sys: {
    glob: vi.fn(),
    file: vi.fn(),
  },
}));

vi.mock('../../utils', () => ({
  getManifestVersions: vi.fn(),
  getReleaseComponent: vi.fn(),
}));

vi.mock('../../git-utils', () => ({
  getRepoInfo: vi.fn(),
}));

describe('CheckstyleParser', () => {
  describe('parseCheckstyleMeta', () => {
    it('should parse valid JSON with name and description', () => {
      const content = JSON.stringify({ name: 'Strict', description: 'A strict ruleset.' });
      const result = parseCheckstyleMeta(
        content,
        'configs/checkstyle/strict',
        'configs-checkstyle-strict-v1.0.0',
        'owner/repo',
      );
      expect(result).toMatchObject({
        name: 'Strict',
        description: 'A strict ruleset.',
        category: 'Checkstyle',
        path: 'configs/checkstyle/strict/checkstyle.xml',
        version:
          '[configs-checkstyle-strict-v1.0.0](https://github.com/owner/repo/releases/tag/configs-checkstyle-strict-v1.0.0)',
      });
      expect(result?.usage).toContain(
        'Vendor `configs/checkstyle/strict/` and `configs/checkstyle/_shared/` into your project',
      );
      // Gradle: reads the config out of the jar via a resolved configuration, not off disk.
      expect(result?.usage).toContain('```kotlin');
      expect(result?.usage).toContain(
        'checkstyleConfig("de.timscho:checkstyle-strict:configs-checkstyle-strict-v1.0.0")',
      );
      expect(result?.usage).toContain('checkstyle("de.timscho:checkstyle-strict:configs-checkstyle-strict-v1.0.0")');
      expect(result?.usage).toContain('resources.text.fromArchiveEntry(checkstyleConfig, "checkstyle.xml")');
      // Maven: configLocation resolved against the plugin's own dependency.
      expect(result?.usage).toContain('```xml');
      expect(result?.usage).toContain('<configLocation>checkstyle.xml</configLocation>');
      expect(result?.usage).toContain('<groupId>de.timscho</groupId>');
      expect(result?.usage).toContain('<artifactId>checkstyle-strict</artifactId>');
      expect(result?.usage).toContain('<version>configs-checkstyle-strict-v1.0.0</version>');
    });

    it('should use directory name when name is missing', () => {
      const content = JSON.stringify({ description: 'A ruleset.' });
      const result = parseCheckstyleMeta(
        content,
        'configs/checkstyle/my-ruleset',
        'configs-checkstyle-my-ruleset-v1.0.0',
        'owner/repo',
      );
      expect(result?.name).toBe('my-ruleset');
    });

    it('should use default description when missing', () => {
      const content = JSON.stringify({ name: 'Default' });
      const result = parseCheckstyleMeta(
        content,
        'configs/checkstyle/default',
        'configs-checkstyle-default-v1.0.0',
        'owner/repo',
      );
      expect(result?.description).toBe('No description provided.');
    });

    it('should return null for invalid JSON', () => {
      const result = parseCheckstyleMeta(
        'invalid-json',
        'configs/checkstyle/default',
        'configs-checkstyle-default-v1.0.0',
        'owner/repo',
      );
      expect(result).toBeNull();
    });

    it('should fall back to vendor-only usage and no version when unreleased', () => {
      const content = JSON.stringify({ name: 'Application', description: 'App rules.' });
      const result = parseCheckstyleMeta(content, 'configs/checkstyle/application', null, 'owner/repo');
      expect(result).toEqual({
        name: 'Application',
        description: 'App rules.',
        usage:
          "Vendor `configs/checkstyle/application/` and `configs/checkstyle/_shared/` into your project, then point your build tool's config directory (Gradle `configDirectory`, Maven `config_loc`) at your copy of `configs/checkstyle/application/`.",
        category: 'Checkstyle',
        path: 'configs/checkstyle/application/checkstyle.xml',
        version: undefined,
      });
    });
  });

  describe('parse', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(GitUtils.getRepoInfo).mockResolvedValue('owner/repo');
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

      vi.mocked(ReadmeUtils.getManifestVersions).mockResolvedValue({
        'configs/checkstyle/application': '1.0.0',
        'configs/checkstyle/library': '2.0.0',
      });
      vi.mocked(ReadmeUtils.getReleaseComponent).mockImplementation(async (dir) => {
        if (dir.includes('application')) return 'configs-checkstyle-application';
        if (dir.includes('library')) return 'configs-checkstyle-library';
        return null;
      });

      const parser = new CheckstyleParser();
      const items = await parser.parse();

      expect(items.map((item) => item.name)).toEqual(['Application', 'Library']);
      expect(items.map((item) => item.path)).toEqual([
        'configs/checkstyle/application/checkstyle.xml',
        'configs/checkstyle/library/checkstyle.xml',
      ]);
      expect(items.map((item) => item.version)).toEqual([
        '[configs-checkstyle-application-v1.0.0](https://github.com/owner/repo/releases/tag/configs-checkstyle-application-v1.0.0)',
        '[configs-checkstyle-library-v2.0.0](https://github.com/owner/repo/releases/tag/configs-checkstyle-library-v2.0.0)',
      ]);
    });

    it('should still list rulesets that have no release component or manifest version, without a Version link', async () => {
      const mockScan = {
        scan: async function* () {
          yield 'configs/checkstyle/application/meta.json';
          yield 'configs/checkstyle/unreleased/meta.json';
        },
      };
      vi.mocked(Sys.glob).mockReturnValue(mockScan as unknown as ReturnType<typeof Sys.glob>);

      vi.mocked(Sys.file).mockImplementation(
        (filePath: string) =>
          ({
            text: async () => {
              if (filePath.includes('unreleased'))
                return JSON.stringify({ name: 'Unreleased', description: 'Not yet released.' });
              return JSON.stringify({ name: 'Application', description: 'App rules.' });
            },
          }) as unknown as ReturnType<typeof Sys.file>,
      );

      vi.mocked(ReadmeUtils.getManifestVersions).mockResolvedValue({
        'configs/checkstyle/application': '1.0.0',
      });
      vi.mocked(ReadmeUtils.getReleaseComponent).mockImplementation(async (dir) => {
        if (dir.includes('application')) return 'configs-checkstyle-application';
        return null;
      });

      const items = await new CheckstyleParser().parse();

      expect(items.map((item) => item.path)).toEqual([
        'configs/checkstyle/application/checkstyle.xml',
        'configs/checkstyle/unreleased/checkstyle.xml',
      ]);
      expect(items.find((item) => item.name === 'Unreleased')?.version).toBeUndefined();
      expect(items.find((item) => item.name === 'Application')?.version).toBe(
        '[configs-checkstyle-application-v1.0.0](https://github.com/owner/repo/releases/tag/configs-checkstyle-application-v1.0.0)',
      );
    });

    it('should produce the same order for every directory-read order', async () => {
      vi.mocked(Sys.file).mockImplementation(
        () =>
          ({
            text: async () => JSON.stringify({ description: 'A description.' }),
          }) as unknown as ReturnType<typeof Sys.file>,
      );

      vi.mocked(ReadmeUtils.getManifestVersions).mockResolvedValue({
        'configs/checkstyle/release-tags': '1.0.0',
        'configs/checkstyle/branch-renovate': '1.0.0',
        'configs/checkstyle/branch-default': '1.0.0',
      });
      vi.mocked(ReadmeUtils.getReleaseComponent).mockImplementation(async (dir) => `component-${dir}`);

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
