import { describe, expect, it } from 'vitest';
import { fc } from '@fast-check/vitest';
import { parseGithubConfig } from '../github-config-parser';

describe('GithubConfigParser Fuzzy', () => {
  it('should correctly parse any valid config object', () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc.option(fc.string(), { nil: undefined }),
          description: fc.option(fc.string(), { nil: undefined }),
        }),
        fc.string(),
        (config, filePath) => {
          const content = JSON.stringify(config);
          const result = parseGithubConfig(content, filePath);

          expect(result).not.toBeNull();
          if (config.name) {
            expect(result!.name).toBe(config.name);
          }
          if (config.description) {
            expect(result!.description).toBe(config.description);
          } else {
            expect(result!.description).toBe('');
          }
          expect(result!.path).toBe(filePath);
          expect(result!.category).toBe('GitHub');
        },
      ),
    );
  });

  it('should return null for invalid JSON', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => {
          try {
            JSON.parse(s);
            return false;
          } catch {
            return true;
          }
        }),
        fc.string(),
        (content, filePath) => {
          const result = parseGithubConfig(content, filePath);
          expect(result).toBeNull();
        },
      ),
    );
  });
});
