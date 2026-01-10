import path from 'node:path';
import chalk from 'chalk';
import { input, search } from '@inquirer/prompts';
import { ACTIONS_DIR, capitalize, createFromTemplate, ROOT_DIR, START_VERSION, Sys } from './utils.js';

export type ResourceType = 'action' | 'workflow';

const RESOURCE_DIRS = {
  action: ACTIONS_DIR,
  workflow: path.join(ROOT_DIR, 'workflows'),
};

// Naming Conventions Helpers
export function generateResourceKey(type: ResourceType, packageName: string, subName: string): string {
  return `${type}s/${packageName}/${subName}`;
}

export function generateComponentName(type: ResourceType, packageName: string, subName: string): string {
  const baseName = `${type}s-${packageName}-${subName}`;
  return type === 'workflow' ? `${baseName}-meta` : baseName;
}

export async function getPackages(type: ResourceType): Promise<string[]> {
  const dir = RESOURCE_DIRS[type];
  if (!Sys.exists(dir)) return [];
  return Sys.readdir(dir).filter((p) => Sys.stat(path.join(dir, p)).isDirectory());
}

export async function getSubResources(type: ResourceType, packageName: string): Promise<string[]> {
  const dir = path.join(RESOURCE_DIRS[type], packageName);
  if (!Sys.exists(dir)) return [];
  return Sys.readdir(dir).filter((p) => Sys.stat(path.join(dir, p)).isDirectory());
}

export async function selectPackage(type: ResourceType, allowCreate = false): Promise<string> {
  const existingPackages = await getPackages(type);
  let packageName: string;

  if (existingPackages.length > 0) {
    const selectedPackage = await search({
      message: allowCreate ? `Select Package (or create new):` : `Select Package:`,
      source: async (input) => {
        const matches = existingPackages.filter((pkg) => pkg.includes(input || ''));
        if (allowCreate) {
          return [
            ...matches.map((pkg) => ({ name: pkg, value: pkg })),
            { name: chalk.green('+ Create New Package'), value: '__NEW__' },
          ];
        }
        return matches.map((pkg) => ({ name: pkg, value: pkg }));
      },
    });

    if (selectedPackage === '__NEW__') {
      packageName = await askForNewPackageName();
    } else {
      packageName = selectedPackage;
    }
  } else if (allowCreate) {
    packageName = await askForNewPackageName();
  } else {
    throw new Error('No packages found.');
  }

  return packageName;
}

async function askForNewPackageName(): Promise<string> {
  return await input({
    message: 'New Package Name (e.g., python, ruby):',
    validate: (input) => /^[a-z0-9-]+$/.test(input) || 'Lowercase, numbers, and hyphens only.',
  });
}

// Release Please Helpers
export async function registerResourceInReleasePlease(type: ResourceType, packageName: string, subName: string) {
  const configPath = path.join(ROOT_DIR, 'release-please-config.json');
  const manifestPath = path.join(ROOT_DIR, '.release-please-manifest.json');

  const key = generateResourceKey(type, packageName, subName);
  const componentName = generateComponentName(type, packageName, subName);

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
      };
      await Sys.write(configPath, JSON.stringify(config, null, 2));
      console.log(chalk.green(`Added ${key} to release-please-config.json`));
    }
  } catch (error) {
    console.warn(
      chalk.yellow(
        `Could not update release-please-config.json: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
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
      manifest[key] = START_VERSION; // Start version
      await Sys.write(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(chalk.green(`Added ${key} to release-please-manifest.json`));
    }
  } catch (error) {
    console.warn(
      chalk.yellow(
        `Could not update release-please-manifest.json: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
}

export async function removeResourceFromReleasePlease(type: ResourceType, packageName: string, subName: string) {
  const configPath = path.join(ROOT_DIR, 'release-please-config.json');
  const manifestPath = path.join(ROOT_DIR, '.release-please-manifest.json');
  const key = generateResourceKey(type, packageName, subName);

  try {
    const configFile = Sys.file(configPath);
    const config = await configFile.json();
    if (config.packages[key]) {
      delete config.packages[key];
      await Sys.write(configPath, JSON.stringify(config, null, 2));
      console.log(chalk.green(`Removed ${key} from release-please-config.json`));
    }
  } catch (error) {
    console.warn(
      chalk.yellow(
        `Could not update release-please-config.json: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
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
    console.warn(
      chalk.yellow(
        `Could not update release-please-manifest.json: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
}

// Verify Workflow Helpers
export async function createVerifyWorkflow(type: ResourceType, packageName: string, subName: string) {
  const componentName = `${type}-${packageName}-${subName}`; // e.g. action-pkg-sub or workflow-pkg-sub
  const workflowName = `verify-${componentName}.yaml`;
  const workflowPath = path.join(ROOT_DIR, '.github', 'workflows', workflowName);
  const templateName = type === 'action' ? 'action/verify-workflow.yaml' : 'workflow/verify-workflow.yaml';

  await createFromTemplate(templateName, workflowPath, {
    packageName,
    subAction: subName, // Template uses 'subAction' variable currently
    subName, // Add subName for newer templates
    capitalizedPackageName: capitalize(packageName),
    capitalizedSubAction: capitalize(subName),
  });
  console.log(chalk.green(`Created verify workflow: .github/workflows/${workflowName}`));
}

export async function removeVerifyWorkflow(type: ResourceType, packageName: string, subName: string) {
  const componentName = `${type}-${packageName}-${subName}`;
  const workflowName = `verify-${componentName}.yaml`;
  const workflowPath = path.join(ROOT_DIR, '.github', 'workflows', workflowName);

  if (Sys.exists(workflowPath)) {
    await Sys.rm(workflowPath);
    console.log(chalk.green(`Removed verify workflow: .github/workflows/${workflowName}`));
  } else {
    console.log(chalk.blue(`Verify workflow not found: .github/workflows/${workflowName}`));
  }
}
