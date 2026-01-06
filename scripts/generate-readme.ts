import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';

import { Sys } from './lib/utils.js';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT_DIR, 'scripts', 'templates', 'README.md');
const README_PATH = path.join(ROOT_DIR, 'README.md');

interface ActionConfig {
  name: string;
  description: string;
}

interface ActionInfo {
  name: string;
  description: string;
  version: string;
  sha: string;
  path: string; // Relative path to action dir
  category: string;
}

async function getGitSha(dir: string): Promise<string> {
  const output = await Sys.exec(`git log -n 1 --pretty=format:%h ${dir}`);
  return output.trim();
}

async function getManifestVersions(): Promise<Record<string, string>> {
  const manifestPath = path.join(ROOT_DIR, '.release-please-manifest.json');
  const file = Sys.file(manifestPath);
  if (await file.exists()) {
    try {
      return await file.json();
    } catch (e) {
      console.warn('⚠️ Failed to parse .release-please-manifest.json:', e);
    }
  }
  return {};
}

const RELEASE_PLEASE_CONFIG = path.join(ROOT_DIR, 'release-please-config.json');

async function getReleaseComponent(dir: string): Promise<string | null> {
  const file = Sys.file(RELEASE_PLEASE_CONFIG);
  if (await file.exists()) {
    try {
      const config = await file.json();
      const normalizedDir = dir.replaceAll('\\', '/');
      if (config.packages?.[normalizedDir]) {
        return config.packages[normalizedDir].component;
      }
    } catch (e) {
      console.warn('⚠️ Failed to read release-please-config:', e);
    }
  }
  return null;
}

async function getRepoInfo(): Promise<string> {
  try {
    const url = await Sys.exec('git config --get remote.origin.url');
    // Support HTTPS and SSH
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    const match = new RegExp(/github\.com[:/]([^/]+)\/([^.]+)/).exec(url.trim());
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
  } catch (e) {
    console.warn('⚠️ Failed to get git remote url:', e);
  }
  return 'owner/repo'; // Fallback
}

export async function main() {
  console.log('🔍 Scanning available actions...');
  const repoId = await getRepoInfo();

  const glob = Sys.glob('actions/**/action.{yml,yaml}');
  const actions: ActionInfo[] = [];

  const manifestShortVersions = await getManifestVersions();

  for await (const file of glob.scan({ cwd: ROOT_DIR })) {
    // file is relative to ROOT_DIR, e.g. actions/custom/action.yml
    const absPath = path.join(ROOT_DIR, file);
    const dir = path.dirname(file);

    // Parse action.yml
    const content = await Sys.file(absPath).text();
    let config: ActionConfig;
    try {
      config = yaml.load(content) as ActionConfig;
    } catch (e) {
      console.warn(`⚠️ Failed to parse ${file}:`, e);
      continue;
    }

    if (!config?.name) {
      console.warn(`⚠️ Skiping ${file}: missing name`);
      continue;
    }

    const sha = await getGitSha(dir);
    let version = 'N/A';

    // Try to get released tag
    const component = await getReleaseComponent(dir);
    if (component) {
      const normalizedDir = dir.replaceAll('\\', '/');
      const shortVersion = manifestShortVersions[normalizedDir];
      if (shortVersion) {
        // Construct tag: component-vX.Y.Z
        version = `${component}-v${shortVersion}`;
      }
    }
    if (version === 'N/A') {
      console.log(`⚠️ Skipping ${file}: no version found`);
      continue;
    }

    // Extract category from path: actions/<category>/<name>/action.yml
    const parts = dir.replaceAll('\\', '/').split('/');
    const category = parts.length >= 3 ? parts[1] : 'Other';

    actions.push({
      name: config.name,
      description: config.description || '',
      version: version,
      sha,
      path: dir,
      category: category.charAt(0).toUpperCase() + category.slice(1),
    });
  }

  // Sort by category then name
  actions.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.name.localeCompare(b.name);
  });

  console.log(`✅ Found ${actions.length} actions.`);

  // Group by category
  const actionsByCategory: Record<string, ActionInfo[]> = {};
  for (const action of actions) {
    if (!actionsByCategory[action.category]) {
      actionsByCategory[action.category] = [];
    }
    actionsByCategory[action.category].push(action);
  }

  // Generate Markdown
  let markdownOutput = '';
  const sortedCategories = Object.keys(actionsByCategory).sort((a, b) => a.localeCompare(b));

  for (const category of sortedCategories) {
    markdownOutput += `### ${category}\n\n`;
    markdownOutput += '| Action | Description | Version | Usage |\n|--------|-------------|---------|-------|\n';

    for (const action of actionsByCategory[category]) {
      // Link the name to the directory (using forward slashes)
      const dirPath = action.path.replaceAll('\\', '/');
      const link = `[${action.name}](./${dirPath})`;
      const desc = action.description.replaceAll('\n', ' ').trim();

      const versionRef = action.version;

      const usage = `\`uses: ${repoId}/${dirPath}@${versionRef}\``;

      markdownOutput += `| ${link} | ${desc} | ${versionRef} | ${usage} |\n`;
    }
    markdownOutput += '\n';
  }

  // Read Template
  const templateFile = Sys.file(TEMPLATE_PATH);
  if (!(await templateFile.exists())) {
    console.error(`❌ Template not found at ${TEMPLATE_PATH}`);
    process.exit(1);
  }
  let readmeContent = await templateFile.text();

  // Replace Placeholder
  readmeContent = readmeContent.replace('<!-- ACTIONS_TABLE -->', markdownOutput);

  // Write README
  await Sys.write(README_PATH, readmeContent);
  console.log(`🎉 Generated README.md at ${README_PATH}`);
}

if (import.meta.main) {
  await main();
}
