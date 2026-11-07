import path from 'node:path';

import { input, search } from '@inquirer/prompts';
import chalk from 'chalk';

import { PINNED } from './e2e-workflow.js';
import { ACTIONS_DIR, capitalize, createFromTemplate, ROOT_DIR, START_VERSION, Sys } from './utils.js';

// Naming Conventions Helpers
/** The action's directory relative to the repository root, which is also its release-please package key. */
export function generateActionKey(packageName: string, subAction: string): string {
  return `actions/${packageName}/${subAction}`;
}

/** The action's release-please component, which prefixes every tag it is released under. */
export function generateComponentName(packageName: string, subAction: string): string {
  return `actions-${packageName}-${subAction}`;
}

function listDirectories(dir: string): string[] {
  if (!Sys.exists(dir)) {
    return [];
  }
  return Sys.readdir(dir).filter((p) => Sys.stat(path.join(dir, p)).isDirectory());
}

export async function getPackages(): Promise<string[]> {
  return listDirectories(ACTIONS_DIR);
}

export async function getSubActions(packageName: string): Promise<string[]> {
  return listDirectories(path.join(ACTIONS_DIR, packageName));
}

export async function selectPackage(allowCreate = false): Promise<string> {
  const existingPackages = await getPackages();
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
export async function registerActionInReleasePlease(packageName: string, subAction: string) {
  const configPath = path.join(ROOT_DIR, 'release-please-config.json');
  const manifestPath = path.join(ROOT_DIR, '.release-please-manifest.json');

  const key = generateActionKey(packageName, subAction);
  const componentName = generateComponentName(packageName, subAction);

  // Update Config
  try {
    const configFile = Sys.file(configPath);
    // Start empty only when the file is missing. A file that exists but cannot be parsed throws, so
    // it is reported below and never overwritten with just the new entry.
    let config: { packages: Record<string, unknown> } = { packages: {} };
    if (Sys.exists(configPath)) {
      config = await configFile.json();
    }

    if (!config.packages) {
      config.packages = {};
    }
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
    if (Sys.exists(manifestPath)) {
      manifest = await manifestFile.json();
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

export async function removeActionFromReleasePlease(packageName: string, subAction: string) {
  const configPath = path.join(ROOT_DIR, 'release-please-config.json');
  const manifestPath = path.join(ROOT_DIR, '.release-please-manifest.json');
  const key = generateActionKey(packageName, subAction);

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
function verifyWorkflowName(packageName: string, subAction: string): string {
  return `verify-action-${packageName}-${subAction}.yaml`;
}

/** Template the verify workflow is rendered from, relative to `scripts/templates`. */
export const VERIFY_WORKFLOW_TEMPLATE = 'action/verify-workflow.yaml';

/**
 * The part of a `PINNED` entry after `@`: the digest and its ` # vX.Y.Z` comment.
 *
 * The template writes the action name itself and takes only this part as a placeholder, because a
 * bare `{{placeholder}}` as a YAML value is a flow mapping and the formatter rewrites it.
 */
function pinnedRef(pin: string): string {
  const at = pin.indexOf('@');
  if (at === -1) {
    throw new Error(`Pinned action ref has no '@': ${pin}`);
  }
  return pin.slice(at + 1);
}

/**
 * Values substituted into the verify workflow template.
 *
 * The action refs come from `PINNED` rather than being written into the template: no Renovate
 * manager reads `scripts/templates`, so a ref hard-coded there never moves, while `PINNED` is kept
 * current by the custom managers in `renovate.json`.
 */
export function verifyWorkflowReplacements(packageName: string, subAction: string): Record<string, string> {
  return {
    packageName,
    subAction,
    capitalizedPackageName: capitalize(packageName),
    capitalizedSubAction: capitalize(subAction),
    hardenRunnerRef: pinnedRef(PINNED.hardenRunner),
    checkoutRef: pinnedRef(PINNED.checkout),
  };
}

export async function createVerifyWorkflow(packageName: string, subAction: string) {
  const workflowName = verifyWorkflowName(packageName, subAction);
  const workflowPath = path.join(ROOT_DIR, '.github', 'workflows', workflowName);

  await createFromTemplate(VERIFY_WORKFLOW_TEMPLATE, workflowPath, verifyWorkflowReplacements(packageName, subAction));
  console.log(chalk.green(`Created verify workflow: .github/workflows/${workflowName}`));
}

export async function removeVerifyWorkflow(packageName: string, subAction: string) {
  const workflowName = verifyWorkflowName(packageName, subAction);
  const workflowPath = path.join(ROOT_DIR, '.github', 'workflows', workflowName);

  if (Sys.exists(workflowPath)) {
    await Sys.rm(workflowPath);
    console.log(chalk.green(`Removed verify workflow: .github/workflows/${workflowName}`));
  } else {
    console.log(chalk.blue(`Verify workflow not found: .github/workflows/${workflowName}`));
  }
}
