import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateSection } from './lib/readme/generator.js';
import { getRepoInfo } from './lib/readme/git-utils.js';
import { ActionParser } from './lib/readme/parsers/action-parser.js';
import { RenovateParser } from './lib/readme/parsers/renovate-parser.js';
import { WorkflowParser } from './lib/readme/parsers/workflow-parser.js';
import { Sys } from './lib/utils.js';

import type { DocumentationItem } from './lib/readme/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const README_TEMPLATE_PATH = path.join(ROOT_DIR, 'scripts', 'templates', 'README.md');
const SECURITY_TEMPLATE_PATH = path.join(ROOT_DIR, 'scripts', 'templates', 'SECURITY.md');
const README_PATH = path.join(ROOT_DIR, 'README.md');
const SECURITY_PATH = path.join(ROOT_DIR, 'SECURITY.md');

export async function main() {
  console.log('🔍 Scanning repository...');

  // 1. Actions
  const actionParser = new ActionParser();
  const actions = await actionParser.parse();
  const actionsOutput = await generateSection(actions, ['Action', 'Description', 'Version', 'Usage'], (item) => {
    const link = `[${item.name}](./${item.path.replaceAll('\\', '/')})`;
    const desc = item.description.replaceAll('\n', ' ').trim();
    return [link, desc, item.version ?? 'N/A', item.usage || ''];
  });

  // 2. Workflows
  const workflowParser = new WorkflowParser();
  const workflows = await workflowParser.parse();
  const workflowsOutput = await generateSection(workflows, ['Workflow', 'Description', 'Version', 'Usage'], (item) => {
    const link = `[${item.name}](./${item.path.replaceAll('\\', '/')})`;
    const desc = item.description.replaceAll('\n', ' ').trim();
    return [link, desc, item.version ?? 'N/A', item.usage || ''];
  });

  // 3. Renovate Configs
  const renovateParser = new RenovateParser();
  const renovateConfigs = await renovateParser.parse();
  const configsOutput = await generateSection(renovateConfigs, ['Config', 'Description', 'Usage'], (item) => {
    const link = `[${item.name}](./${item.path.replaceAll('\\', '/')})`;
    const desc = item.description.replaceAll('\n', ' ').trim();
    return [link, desc, item.usage || ''];
  });

  // 4. Update README
  await updateReadme(actionsOutput, workflowsOutput, configsOutput);

  // 5. Update SECURITY.md
  await updateSecurity(actions, workflows);
}

async function updateReadme(actionsOutput: string, workflowsOutput: string, configsOutput: string) {
  const templateFile = Sys.file(README_TEMPLATE_PATH);
  if (!(await templateFile.exists())) {
    console.error(`❌ Template not found at ${README_TEMPLATE_PATH}`);
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

async function updateSecurity(actions: DocumentationItem[], workflows: DocumentationItem[]) {
  const templateFile = Sys.file(SECURITY_TEMPLATE_PATH);
  if (!(await templateFile.exists())) {
    console.error(`❌ Template not found at ${SECURITY_TEMPLATE_PATH}`);
    process.exit(1);
  }
  let securityContent = await templateFile.text();

  // Filter items that have versions
  const versionedActions = actions.filter((item) => item.version && item.version !== 'N/A');
  const versionedWorkflows = workflows.filter((item) => item.version && item.version !== 'N/A');

  let supportedVersionsOutput = '';

  if (versionedActions.length > 0) {
    supportedVersionsOutput += '### Actions\n\n';
    supportedVersionsOutput += await generateSection(
      versionedActions,
      ['Component', 'Version', 'Supported'],
      (item) => {
        const link = `[${item.name}](./${item.path.replaceAll('\\', '/')})`;
        return [link, item.version!, ':white_check_mark:'];
      },
    );
  }

  if (versionedWorkflows.length > 0) {
    if (supportedVersionsOutput) supportedVersionsOutput += '\n'; // spacing
    supportedVersionsOutput += '### Workflows\n\n';
    supportedVersionsOutput += await generateSection(
      versionedWorkflows,
      ['Component', 'Version', 'Supported'],
      (item) => {
        const link = `[${item.name}](./${item.path.replaceAll('\\', '/')})`;
        return [link, item.version!, ':white_check_mark:'];
      },
    );
  }

  securityContent = securityContent.replace('<!-- SUPPORTED_VERSIONS_TABLE -->', supportedVersionsOutput);

  await Sys.write(SECURITY_PATH, securityContent);
  console.log(`🎉 Generated SECURITY.md at ${SECURITY_PATH}`);
}

if (import.meta.main) {
  await main();
}
