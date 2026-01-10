import path from 'node:path';
import yaml from 'js-yaml';
import { ROOT_DIR, Sys } from '../../utils.js';
import type { DocumentationItem, Parser } from '../types.js';
import { getManifestVersions, getReleaseComponent } from '../utils.js';
import { getRepoInfo } from '../git-utils.js';

interface ActionConfig {
  name: string;
  description: string;
}

export interface ActionMetadata {
  name: string;
  description: string;
  version: string;
  usage: string;
  category: string;
}

export function deriveActionMetadata(
  dir: string,
  version: string,
  repoId: string,
  configName: string,
  configDescription?: string,
): ActionMetadata {
  const parts = dir.replaceAll('\\', '/').split('/');
  const category = parts.length >= 3 ? parts[1] : 'Other';
  const dirPath = dir.replaceAll('\\', '/');

  return {
    name: configName,
    description: configDescription || '',
    version,
    usage: `\`uses: ${repoId}/${dirPath}@${version}\``,
    category: category.charAt(0).toUpperCase() + category.slice(1),
  };
}

export class ActionParser implements Parser {
  async parse(): Promise<DocumentationItem[]> {
    const items: DocumentationItem[] = [];
    const glob = Sys.glob('actions/**/action.{yml,yaml}');
    const manifestShortVersions = await getManifestVersions();
    const repoId = await getRepoInfo();

    for await (const file of glob.scan({ cwd: ROOT_DIR })) {
      const absPath = path.join(ROOT_DIR, file);
      const dir = path.dirname(file);

      const content = await Sys.file(absPath).text();
      let config: ActionConfig;
      try {
        config = yaml.load(content) as ActionConfig;
      } catch (e) {
        console.warn(`⚠️ Failed to parse ${file}:`, e);
        continue;
      }

      if (!config?.name) continue;

      let version = 'N/A';
      const component = await getReleaseComponent(dir);
      if (component) {
        const normalizedDir = dir.replaceAll('\\', '/');
        const shortVersion = manifestShortVersions[normalizedDir];
        if (shortVersion) {
          version = `${component}-v${shortVersion}`;
        }
      }

      if (version === 'N/A') {
        console.log(`⚠️ Skipping ${file}: no version found`);
        continue;
      }

      const metadata = deriveActionMetadata(dir, version, repoId, config.name, config.description);

      items.push({
        name: metadata.name,
        description: metadata.description,
        version: metadata.version,
        usage: metadata.usage,
        category: metadata.category,
        path: dir,
      });
    }
    return items;
  }
}
