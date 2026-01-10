import path from 'node:path';
import { ROOT_DIR, Sys } from '../../utils.js';
import type { DocumentationItem, Parser } from '../types.js';
import { getRepoInfo } from '../git-utils.js';

export class RenovateParser implements Parser {
  async parse(): Promise<DocumentationItem[]> {
    const items: DocumentationItem[] = [];
    const glob = Sys.glob('configs/renovate/*.json');
    const repoId = await getRepoInfo();

    for await (const file of glob.scan({ cwd: ROOT_DIR })) {
      const absPath = path.join(ROOT_DIR, file);
      const content = await Sys.file(absPath).text();

      let config: { description?: string };
      try {
        config = JSON.parse(content);
      } catch (e) {
        console.warn(`⚠️ Failed to parse ${file}:`, e);
        continue;
      }

      const basename = path.basename(file, '.json');
      const dirPath = path.dirname(file).replaceAll('\\', '/');

      items.push({
        name: basename,
        description: config.description || 'No description provided.',
        usage: `\`"extends": ["github>${repoId}//${dirPath}/${basename}"]\``,
        category: 'Renovate',
        path: file,
      });
    }
    return items;
  }
}
