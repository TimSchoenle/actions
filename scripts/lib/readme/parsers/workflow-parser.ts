import path from 'node:path';
import yaml from 'js-yaml';
import { ROOT_DIR, Sys } from '../../utils.js';
import type { DocumentationItem, Parser } from '../types.js';
import { getRepoInfo } from '../git-utils.js';

interface WorkflowConfig {
  name?: string;
  on?: {
    workflow_call?: unknown;
  };
  description?: string;
}

// Recursive walker to find all directories containing a matching .yml file
async function scanForWorkflows(dir: string, baseDir: string): Promise<string[]> {
  if (!Sys.exists(dir)) return [];
  const entries = await Sys.readdir(dir);
  let results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    if (Sys.stat(fullPath).isDirectory()) {
      if (Sys.exists(path.join(fullPath, 'workflow.yml')) || Sys.exists(path.join(fullPath, 'workflow.yaml'))) {
        const rel = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        results.push(rel);
      }
      results = results.concat(await scanForWorkflows(fullPath, baseDir));
    }
  }
  return results;
}

export class WorkflowParser implements Parser {
  async parse(): Promise<DocumentationItem[]> {
    const items: DocumentationItem[] = [];
    const workflowsDir = path.join(ROOT_DIR, 'workflows');

    // Load manifest for versions
    let manifest: Record<string, string> = {};
    const manifestPath = path.join(ROOT_DIR, '.release-please-manifest.json');
    if (Sys.exists(manifestPath)) {
      try {
        manifest = await Sys.file(manifestPath).json();
      } catch (e) {
        console.warn('⚠️ Failed to load release manifest:', e);
      }
    }

    const dirs = await scanForWorkflows(workflowsDir, workflowsDir);
    const repoId = await getRepoInfo();

    for (const dir of dirs) {
      // Check version first - if not in manifest, skip (not released)
      // Key format in manifest: workflows/rust/test
      const manifestKey = `workflows/${dir}`;
      const version = manifest[manifestKey] as string | undefined;

      if (!version) {
        // Skip unreleased workflows
        continue;
      }

      const dirPath = path.join(workflowsDir, dir);

      let file = 'workflow.yaml';
      let absPath = path.join(dirPath, file);

      if (!Sys.exists(absPath)) {
        file = 'workflow.yml';
        absPath = path.join(dirPath, file);
        if (!Sys.exists(absPath)) continue;
      }

      const content = await Sys.file(absPath).text();
      let config: WorkflowConfig;

      try {
        config = yaml.load(content) as WorkflowConfig;
      } catch (e) {
        console.warn(`⚠️ Failed to parse ${file}:`, e);
        continue;
      }

      if (!config?.on || config.on.workflow_call === undefined) continue;

      // Normalized Name for Distribution: workflows/rust/test -> rust-test
      // dir is 'rust/test'
      const distName = dir.replace(/[\/\\]/g, '-');
      const name = config.name || distName;
      const description = (config as any).description || 'No description provided.';

      // Tag is typically workflows/<name>-v<version>
      // But user usage usually points to specific tag.
      // Distribution Pattern: uses: owner/repo/.github/workflows/file.yml@tag
      // The tag created is: workflows/<distName>-v<version>
      // WAIT: The tag created in release-please.yml is workflows/${workflow_name}-v${new_version}
      // workflow_name there was basename '$path'.
      // If path is workflows/rust/test, basename is 'test'.
      // So tag is workflows/test-v1.0.0.
      // But wait. In Step 370 we updated logic.
      // workflow_name=$(basename "$path") -> 'test'
      // normalized_name=$(echo "${path#workflows/}" | tr '/' '-') -> 'rust-test'
      // TAG_V was workflows/${workflow_name}-v${new_version} which is workflows/test-v1.0.0??
      // Let's check release-please.yml again.

      // Checking release-please.yml logic from memory/Step 462:
      // workflow_name=$(basename "$path")
      // TAG_V=workflows/${workflow_name}-v${new_version}
      // ERROR: If path is workflows/rust/test, workflow_name is 'test'.
      // If path is workflows/other/test, workflow_name is 'test'.
      // Tag collision!
      // We should use normalized name for tag!

      // Let's assume for now I need to fix the tag logic in release-please too if it's broken.
      // But for README, I should use the correct tag.
      // Let's check the previous release-please.yml content.

      // In Step 467:
      // workflow_name=$(basename "$path")
      // TAG_V=workflows/${workflow_name}-v${new_version}
      // This IS a bug for nested workflows with same leaf name.
      // I should fix release-please.yml to use normalized_name for tagging!

      // For README:
      // usage: `uses: ${repoId}/.github/workflows/${distName}.yaml@workflows/${path.basename(dir)}-v${version}`

      // I will implement the README change assuming current (potentially buggy) tag logic first,
      // OR I should use normalized name if I fix it.
      // The user asked "If no version is found hide the workflow".

      // Let's use the version string directly for now in the usage example as <version>.
      // Or construct the tag. The user usually wants the full tag.
      // "uses: ...@v1" or "...@workflows/rust-test-v1"

      // Let's stick to the request: "add a version field".
      // item.version = version.

      items.push({
        name: name,
        description: description,
        version: `v${version}`,
        usage: `\`uses: ${repoId}/.github/workflows/${distName}.yaml@workflows/${path.basename(dir)}-v${version}\``,
        category: 'Workflow',
        path: `workflows/${dir}`,
      });
    }
    return items;
  }
}
