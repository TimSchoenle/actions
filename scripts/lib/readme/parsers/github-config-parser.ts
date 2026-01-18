import path from 'node:path';

import { ROOT_DIR, Sys } from '../../utils.js';

import type { DocumentationItem, Parser } from '../types.js';

export function parseGithubConfig(content: string, filePath: string): DocumentationItem | null {
  let config: { name?: string; description?: string };
  try {
    config = JSON.parse(content);
  } catch {
    return null;
  }

  return {
    name: config.name || path.basename(filePath, '.json'),
    description: config.description || '',
    usage: '',
    category: 'GitHub',
    path: filePath,
  };
}

export class GithubConfigParser implements Parser {
  async parse(): Promise<DocumentationItem[]> {
    const items: DocumentationItem[] = [];
    const glob = Sys.glob('configs/github-rulesets/*.json');

    for await (const file of glob.scan({ cwd: ROOT_DIR })) {
      const absPath = path.join(ROOT_DIR, file);
      const content = await Sys.file(absPath).text();

      const item = parseGithubConfig(content, file);
      if (item) {
        items.push(item);
      } else {
        console.warn(`⚠️ Failed to parse ${file}`);
      }
    }
    return items;
  }
}
