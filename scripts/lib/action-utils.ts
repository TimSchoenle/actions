import path from 'node:path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import autocompletePrompt from 'inquirer-autocomplete-prompt';
import { ACTIONS_DIR, Sys, ROOT_DIR, capitalize, createFromTemplate, START_VERSION } from './utils.js';

inquirer.registerPrompt('autocomplete', autocompletePrompt);

export async function getPackages(): Promise<string[]> {
    if (!Sys.exists(ACTIONS_DIR)) return [];
    return Sys.readdir(ACTIONS_DIR).filter((p) => Sys.stat(path.join(ACTIONS_DIR, p)).isDirectory());
}

export async function getSubActions(packageName: string): Promise<string[]> {
    const packagePath = path.join(ACTIONS_DIR, packageName);
    if (!Sys.exists(packagePath)) return [];
    return Sys.readdir(packagePath).filter((p) => Sys.stat(path.join(packagePath, p)).isDirectory());
}

export async function selectPackage(allowCreate = false): Promise<string> {
    const existingPackages = await getPackages();
    let packageName: string;

    if (existingPackages.length > 0) {
        const { selectedPackage } = await inquirer.prompt([
            {
                type: 'autocomplete',
                name: 'selectedPackage',
                message: allowCreate ? 'Select Package (or create new):' : 'Select Package:',
                source: async (_answers: unknown, input = '') => {
                    const matches = existingPackages.filter((pkg) => pkg.includes(input));
                    if (allowCreate) {
                        return [
                            ...matches,
                            new inquirer.Separator(),
                            { name: chalk.green('+ Create New Package'), value: '__NEW__' },
                        ];
                    }
                    return matches;
                },
            },
        ] as any);

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
    const { name } = await inquirer.prompt([
        {
            type: 'input',
            name: 'name',
            message: 'New Package Name (e.g., python, ruby):',
            validate: (input) => /^[a-z0-9-]+$/.test(input) || 'Lowercase, numbers, and hyphens only.',
        },
    ]);
    return name;
}

// Release Please Helpers
export async function registerActionInReleasePlease(packageName: string, subAction: string) {
    const configPath = path.join(ROOT_DIR, '.release-please-config.json');
    const manifestPath = path.join(ROOT_DIR, '.release-please-manifest.json');
    const key = `actions/${packageName}/${subAction}`;

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
                'release-type': 'action',
                component: `actions/${packageName}/${subAction}`,
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

export async function removeActionFromReleasePlease(packageName: string, subAction: string) {
    const configPath = path.join(ROOT_DIR, '.release-please-config.json');
    const manifestPath = path.join(ROOT_DIR, '.release-please-manifest.json');
    const key = `actions/${packageName}/${subAction}`;

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
export async function createVerifyWorkflow(packageName: string, subAction: string) {
    const workflowPath = path.join(ROOT_DIR, '.github', 'workflows', `verify-action-${packageName}-${subAction}.yaml`);

    await createFromTemplate('action/verify-workflow.yaml', workflowPath, {
        packageName,
        subAction,
        capitalizedPackageName: capitalize(packageName),
        capitalizedSubAction: capitalize(subAction),
    });
    console.log(chalk.green(`Created verify workflow: .github/workflows/verify-action-${packageName}-${subAction}.yaml`));
}

export async function removeVerifyWorkflow(packageName: string, subAction: string) {
    const workflowPath = path.join(ROOT_DIR, '.github', 'workflows', `verify-action-${packageName}-${subAction}.yaml`);

    if (Sys.exists(workflowPath)) {
        await Sys.rm(workflowPath);
        console.log(chalk.green(`Removed verify workflow: .github/workflows/verify-action-${packageName}-${subAction}.yaml`));
    } else {
        console.log(chalk.blue(`Verify workflow not found: .github/workflows/verify-action-${packageName}-${subAction}.yaml`));
    }
}
