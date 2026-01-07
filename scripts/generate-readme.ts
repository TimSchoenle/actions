import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Sys } from './lib/utils.js';
import { ActionParser } from './lib/readme/parsers/action-parser.js';
import { RenovateParser } from './lib/readme/parsers/renovate-parser.js';
import { WorkflowParser } from './lib/readme/parsers/workflow-parser.js';
import { generateSection } from './lib/readme/generator.js';
import { getRepoInfo } from './lib/readme/git-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT_DIR, 'scripts', 'templates', 'README.md');
const README_PATH = path.join(ROOT_DIR, 'README.md');

export async function main() {
  console.log('🔍 Scanning repository...');

  // 1. Actions
  const actionParser = new ActionParser();
  const actions = await actionParser.parse();
  const actionsOutput = await generateSection(actions, ['Action', 'Description', 'Version', 'Usage'], (item) => {
    const p = item.path ? item.path.replaceAll('\\', '/') : '';
    const link = `[${item.name}](./${p})`;
    const desc = item.description ? String(item.description).replaceAll('\n', ' ').trim() : '';
    return [link, desc, item.version ?? 'N/A', item.usage || ''];
  });

  // 2. Reusable Workflows
  const workflowParser = new WorkflowParser();
  const workflows = await workflowParser.parse();
  const workflowsOutput = await generateSection(workflows, ['Workflow', 'Description', 'Version', 'Usage'], (item) => {
    const p = item.path ? item.path.replaceAll('\\', '/') : '';
    const link = `[${item.name}](./${p})`;
    const desc = item.description ? String(item.description).replaceAll('\n', ' ').trim() : '';
    return [link, desc, item.version ?? 'Latest', item.usage || ''];
  });

  // 3. Renovate Configs
  const renovateParser = new RenovateParser();
  const renovateConfigs = await renovateParser.parse();
  const configsOutput = await generateSection(renovateConfigs, ['Config', 'Description', 'Usage'], (item) => {
    const p = item.path ? item.path.replaceAll('\\', '/') : '';
    const link = `[${item.name}](./${p})`;
    const desc = item.description ? String(item.description).replaceAll('\n', ' ').trim() : '';
    return [link, desc, item.usage || ''];
  });

  // 3. Update README
  const templateFile = Sys.file(TEMPLATE_PATH);
  if (!(await templateFile.exists())) {
    console.error(`❌ Template not found at ${TEMPLATE_PATH}`);
    process.exit(1);
  }
  let readmeContent = await templateFile.text();

  // Replace Repo Info
  const repoId = await getRepoInfo();
  readmeContent = readmeContent.replaceAll('{{REPO}}', repoId);

  readmeContent = readmeContent.replace('<!-- ACTIONS_TABLE -->', actionsOutput);
  readmeContent = readmeContent.replace('<!-- WORKFLOWS_TABLE -->', workflowsOutput);
  readmeContent = readmeContent.replace('<!-- CONFIGS_TABLE -->', configsOutput);

  await Sys.write(README_PATH, readmeContent);
  console.log(`🎉 Generated README.md at ${README_PATH}`);
}

if (import.meta.main) {
  await main();
}
