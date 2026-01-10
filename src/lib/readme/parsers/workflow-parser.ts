import path from 'node:path';
import yaml from 'js-yaml';
import { ROOT_DIR, Sys } from '../../utils.js';
import type { DocumentationItem, Parser } from '../types.js';
import { getManifestVersions } from '../utils.js';
import { getRepoInfo } from '../git-utils.js';

interface WorkflowConfig {
  name: string;
  description?: string;
  on?: Record<string, unknown>; // Trigger
}

export interface WorkflowMetadata {
  name: string;
  description: string;
  version: string;
  usage: string;
  category: string;
}

export function deriveWorkflowMetadata(
  dir: string,
  shortVersion: string,
  repoId: string,
  configName?: string,
  configDescription?: string,
): WorkflowMetadata | null {
  const normalizedDir = dir.replaceAll('\\', '/');

  // Derivation Logic (Matches publish-workflow job)
  // Path: workflows/common/test2
  // Component Name (Clean): workflows-common-test2
  const parts = normalizedDir.split('/'); // ["workflows", "common", "test2"]
  if (parts.length < 3 || parts[0] !== 'workflows') return null;

  const componentSuffix = parts.slice(1).join('-'); // "common-test2"
  const cleanComponentName = `workflows-${componentSuffix}`; // "workflows-common-test2"
  const targetFileName = `${componentSuffix}.yaml`; // "common-test2.yaml"
  const tag = `${cleanComponentName}-v${shortVersion}`; // "workflows-common-test2-v2.5.0"

  const category = parts.length >= 3 ? parts[1] : 'Other'; // "common"

  return {
    name: configName || componentSuffix,
    description: configDescription || `Reusable workflow for ${componentSuffix}`,
    version: tag,
    // Correct Usage for Clean Release
    usage: `\`uses: ${repoId}/.github/workflows/${targetFileName}@${tag}\``,
    category: category.charAt(0).toUpperCase() + category.slice(1),
  };
}

export class WorkflowParser implements Parser {
  async parse(): Promise<DocumentationItem[]> {
    const items: DocumentationItem[] = [];
    // Scan all workflow.yaml files inside the workflows/ directory
    const glob = Sys.glob('workflows/**/workflow.yaml');
    const manifestShortVersions = await getManifestVersions();
    const repoId = await getRepoInfo();

    for await (const file of glob.scan({ cwd: ROOT_DIR })) {
      const absPath = path.join(ROOT_DIR, file);
      const dir = path.dirname(file); // e.g. workflows/common/test2

      const content = await Sys.file(absPath).text();
      let config: WorkflowConfig;
      try {
        config = yaml.load(content) as WorkflowConfig;
      } catch (e) {
        console.warn(`⚠️ Failed to parse ${file}:`, e);
        continue;
      }

      const normalizedDir = dir.replaceAll('\\', '/');
      const shortVersion = manifestShortVersions[normalizedDir]; // e.g. "2.5.0"

      if (!shortVersion) {
        console.log(`⚠️ Skipping ${file}: no version found in manifest`);
        continue;
      }

      const metadata = deriveWorkflowMetadata(dir, shortVersion, repoId, config.name, config.description);
      if (!metadata) continue;

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
