import path from 'node:path';

import { ROOT_DIR, Sys } from '../../utils.js';
import { sortDocumentationItems } from './sort.js';

import type { DocumentationItem, Parser } from '../types.js';

/**
 * `config_loc` is a convention property every build tool sets to a local directory of its own
 * choosing (Gradle's `configDirectory`, Maven's `propertyExpansion`) - it is never derived from a
 * remote `configLocation` URL. So a ruleset's suppression files, and its `../_shared/` sibling, only
 * resolve once a consumer has vendored them onto disk together; a bare raw-GitHub-URL `configLocation`
 * would silently fail to find them.
 */
export function parseCheckstyleMeta(content: string, dirPath: string): DocumentationItem | null {
  let meta: { name?: string; description?: string };
  try {
    meta = JSON.parse(content);
  } catch {
    return null;
  }

  const normalizedDir = dirPath.replaceAll('\\', '/');
  const basename = path.basename(normalizedDir);
  const rulesetPath = `${normalizedDir}/checkstyle.xml`;

  return {
    name: meta.name || basename,
    description: meta.description || 'No description provided.',
    usage: `Vendor \`${normalizedDir}/\` and \`configs/checkstyle/_shared/\` into your project, then point your build tool's config directory (Gradle \`configDirectory\`, Maven \`config_loc\`) at your copy of \`${normalizedDir}/\`.`,
    category: 'Checkstyle',
    path: rulesetPath,
  };
}

export class CheckstyleParser implements Parser {
  async parse(): Promise<DocumentationItem[]> {
    const items: DocumentationItem[] = [];
    const glob = Sys.glob('configs/checkstyle/*/meta.json');

    for await (const file of glob.scan({ cwd: ROOT_DIR })) {
      const absPath = path.join(ROOT_DIR, file);
      const content = await Sys.file(absPath).text();

      const item = parseCheckstyleMeta(content, path.dirname(file));
      if (item) {
        items.push(item);
      } else {
        console.warn(`⚠️ Failed to parse ${file}`);
      }
    }
    return sortDocumentationItems(items);
  }
}
