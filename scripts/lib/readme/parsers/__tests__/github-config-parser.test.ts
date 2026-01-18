import { describe, expect, it } from 'vitest';
import { parseGithubConfig } from '../github-config-parser';

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
});
