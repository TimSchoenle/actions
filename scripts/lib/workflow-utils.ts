import path from 'node:path';
import chalk from 'chalk';
import { ROOT_DIR, Sys, createFromTemplate } from './utils.js';

// Source workflows live in 'workflows/' source directory (Source of Truth)
// Published workflows go to '.github/workflows/' via distribution workflow
const WORKFLOWS_SRC_DIR = path.join(ROOT_DIR, 'workflows');

// Recursive walker to find all directories containing a matching .yml file
async function scanForWorkflows(dir: string, baseDir: string): Promise<string[]> {
  if (!Sys.exists(dir)) return [];
  const entries = Sys.readdir(dir);
  let results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    if (Sys.stat(fullPath).isDirectory()) {
      // Check if this dir contains a matching yaml file?
      // Convention: dir 'foo' contains 'workflow.yml' or 'workflow.yaml'
      if (Sys.exists(path.join(fullPath, 'workflow.yml')) || Sys.exists(path.join(fullPath, 'workflow.yaml'))) {
        const rel = path.relative(baseDir, fullPath).replaceAll('\\', '/');
        results.push(rel);
      }
      // Continue recursion
      results = results.concat(await scanForWorkflows(fullPath, baseDir));
    }
  }
  return results;
}

import { input, search } from '@inquirer/prompts';

export async function getWorkflowNames(): Promise<string[]> {
  return scanForWorkflows(WORKFLOWS_SRC_DIR, WORKFLOWS_SRC_DIR);
}

// Interactive selector for creating a workflow
export async function selectWorkflowDestination(): Promise<string> {
  let currentPath = WORKFLOWS_SRC_DIR;

  while (true) {
    // List subdirectories
    const entries = Sys.readdir(currentPath).filter((p) => Sys.stat(path.join(currentPath, p)).isDirectory());
    // Also check if we should show "Create Here"
    // (Only if we are at least one level deep? Or root is allowed?)
    // Root workflows? 'workflows/my-workflow.yaml'. Not recommended but possible.
    // Let's allow root.

    const relativePath = path.relative(WORKFLOWS_SRC_DIR, currentPath) || 'root';

    // Options
    const choices: { name: string; value: string }[] = entries.map((d) => ({ name: d, value: d }));

    // Only allow creating a workflow if we are NOT in the root directory
    if (currentPath !== WORKFLOWS_SRC_DIR) {
      choices.unshift({ name: chalk.green(`+ Create Workflow in "${relativePath}"`), value: '__HERE__' });
    }
    choices.push({ name: chalk.green(`+ Create New Folder`), value: '__NEW__' });

    const selected = await search({
      message: `Navigate to destination (Current: ${relativePath})`,
      source: async (term) => {
        return choices.filter((c) => c.name.toLowerCase().includes((term || '').toLowerCase()));
      },
    });

    if (selected === '__HERE__') {
      return path.relative(WORKFLOWS_SRC_DIR, currentPath);
    } else if (selected === '__NEW__') {
      const newName = await input({
        message: 'Folder Name:',
        validate: (input) => /^[a-z0-9-]+$/.test(input) || 'Lowercase, numbers, and hyphens only.',
      });
      currentPath = path.join(currentPath, newName);
      if (!Sys.exists(currentPath)) {
        await Sys.mkdir(currentPath);
      }
    } else {
      currentPath = path.join(currentPath, selected);
    }
  }
}

// Interactive selector for removing a workflow
export async function selectWorkflowToRemove(): Promise<string> {
  const allWorkflows = await getWorkflowNames(); // ['rust/test', 'go/build']

  if (allWorkflows.length === 0) {
    throw new Error('No workflows found.');
  }
  let currentPath = WORKFLOWS_SRC_DIR;

  while (true) {
    const relativePath = path.relative(WORKFLOWS_SRC_DIR, currentPath) || 'root';

    // List entries: folders and workflows
    // A folder might CONTAIN a workflow AND have subfolders.
    const entries = Sys.readdir(currentPath);
    const choices = [];

    let isWorkflow = false;
    if (Sys.exists(path.join(currentPath, 'workflow.yaml')) || Sys.exists(path.join(currentPath, 'workflow.yml'))) {
      isWorkflow = true;
      choices.push({ name: chalk.red(`🗑️  Remove "${relativePath}"`), value: '__REMOVE__' });
    }

    for (const entry of entries) {
      if (Sys.stat(path.join(currentPath, entry)).isDirectory()) {
        choices.push({ name: entry, value: entry });
      }
    }

    if (currentPath !== WORKFLOWS_SRC_DIR) {
      choices.push({ name: '.. (Up)', value: '__UP__' });
    }

    if (choices.length === 0) {
      console.log('Empty directory.');
      // Go up automatically?
      currentPath = path.dirname(currentPath);
      continue;
    }

    const selected = await search({
      message: `Select workflow or folder (Current: ${relativePath})`,
      source: async (term) => {
        return choices.filter((c) => c.name.toLowerCase().includes((term || '').toLowerCase()));
      },
    });

    if (selected === '__REMOVE__') {
      return relativePath.replaceAll('\\', '/');
    } else if (selected === '__UP__') {
      currentPath = path.dirname(currentPath);
    } else {
      // Enter directory
      currentPath = path.join(currentPath, selected);
    }
  }
}

export async function createWorkflow(name: string, description: string) {
  // name could be 'rust/test'
  // Normalize path separators
  const nameParts = name.split(/[\\/]/);
  const leafName = nameParts.at(-1); // 'test'

  const workflowDir = path.join(WORKFLOWS_SRC_DIR, name); // workflows/rust/test
  const workflowFile = path.join(workflowDir, 'workflow.yaml'); // workflows/rust/test/workflow.yaml

  if (Sys.exists(workflowDir)) {
    throw new Error(`Workflow source directory ${name} already exists at ${workflowDir}`);
  }

  await Sys.mkdir(workflowDir, { recursive: true });

  await createFromTemplate('workflow/reusable-workflow.yaml', workflowFile, {
    name: leafName, // or flattened name? usually short name inside content
    description,
  });

  console.log(chalk.green(`Created workflow source: workflows/${name}/${leafName}.yml`));

  await registerWorkflowInReleasePlease(name);
}

export async function removeWorkflow(name: string) {
  const workflowDir = path.join(WORKFLOWS_SRC_DIR, name);

  if (Sys.exists(workflowDir)) {
    await Sys.rm(workflowDir, { recursive: true, force: true });
    console.log(chalk.green(`Removed workflow source: ${workflowDir}`));
    // Also remove from release config
    await removeWorkflowFromReleasePlease(name);
  } else {
    console.log(chalk.blue(`Workflow source not found: ${name}`));
  }
}

// Release Please Helpers
export async function registerWorkflowInReleasePlease(name: string) {
  const configPath = path.join(ROOT_DIR, 'release-please-config.json');
  const manifestPath = path.join(ROOT_DIR, '.release-please-manifest.json');
  // Normalize name for key: rust/test -> workflows/rust/test
  const key = `workflows/${name}`;
  // Component name: workflows-rust-test
  const componentName = `workflows-${name.replaceAll(/[\\/]/g, '-')}`;

  // Update Config
  try {
    const configFile = Sys.file(configPath);
    let config: { packages: Record<string, unknown> } = { packages: {} };
    try {
      config = await configFile.json();
    } catch {
      // ignore
    }

    if (!config.packages) config.packages = {};
    if (!config.packages[key]) {
      config.packages[key] = {
        'release-type': 'simple',
        component: componentName,
        'include-component-in-tag': true,
        'skip-github-release': true, // Distribution Pattern (Skip tag/release creation)
      };
      await Sys.write(configPath, JSON.stringify(config, null, 2));
      console.log(chalk.green(`Added ${key} to release-please-config.json (skip-github-release: true)`));
    }
  } catch (error) {
    console.warn(chalk.yellow(`Could not update release-please-config.json: ${error}`));
  }

  // Update Manifest
  try {
    const manifestFile = Sys.file(manifestPath);
    let manifest: Record<string, string> = {};
    try {
      manifest = await manifestFile.json();
    } catch {
      // ignore
    }

    if (!manifest[key]) {
      manifest[key] = '1.0.0'; // Start version
      await Sys.write(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(chalk.green(`Added ${key} to release-please-manifest.json`));
    }
  } catch (error) {
    console.warn(chalk.yellow(`Could not update release-please-manifest.json: ${error}`));
  }
}

export async function removeWorkflowFromReleasePlease(name: string) {
  const configPath = path.join(ROOT_DIR, 'release-please-config.json');
  const manifestPath = path.join(ROOT_DIR, '.release-please-manifest.json');
  const key = `workflows/${name}`;

  try {
    const configFile = Sys.file(configPath);
    const config = await configFile.json();
    if (config.packages[key]) {
      delete config.packages[key];
      await Sys.write(configPath, JSON.stringify(config, null, 2));
      console.log(chalk.green(`Removed ${key} from release-please-config.json`));
    }
  } catch (error) {
    console.warn(chalk.yellow(`Error removing from config: ${error}`));
  }

  try {
    const manifestFile = Sys.file(manifestPath);
    const manifest = await manifestFile.json();
    if (manifest[key]) {
      delete manifest[key];
      await Sys.write(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(chalk.green(`Removed ${key} from release-please-manifest.json`));
    }
  } catch (error) {
    console.warn(chalk.yellow(`Error removing from manifest: ${error}`));
  }
}
