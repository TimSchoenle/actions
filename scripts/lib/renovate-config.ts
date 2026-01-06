import path from 'node:path';
import { ROOT_DIR, Sys, getRepoName } from './utils.js';

const RENOVATE_CONFIG_PATH = path.join(ROOT_DIR, 'configs', 'renovate', 'base.json');

export interface RenovatePackageRule {
  matchDepNames?: string[];
  matchPackageNames?: string[];
  description?: string;
  versioning?: string;
  [key: string]: unknown;
}

export interface RenovateConfig {
  packageRules: RenovatePackageRule[];
  [key: string]: unknown;
}

export class RenovateConfigManager {
  /**
   * Reads the Renovate config file.
   */
  static async readConfig(): Promise<RenovateConfig> {
    if (!Sys.exists(RENOVATE_CONFIG_PATH)) {
      throw new Error(`Renovate config not found at ${RENOVATE_CONFIG_PATH}`);
    }
    const content = await Sys.file(RENOVATE_CONFIG_PATH).text();
    return JSON.parse(content);
  }

  /**
   * Writes the Renovate config file.
   */
  static async writeConfig(config: RenovateConfig): Promise<void> {
    const content = JSON.stringify(config, null, 4) + '\n';
    await Sys.write(RENOVATE_CONFIG_PATH, content);
  }

  /**
   * Adds a versioning package rule for a specific action.
   */
  static async addPackageRule(packageName: string, subAction: string): Promise<void> {
    const config = await this.readConfig();
    const repoName = await getRepoName();
    const fullActionName = `${repoName}/actions/${packageName}/${subAction}`;

    // Construct the regex pattern dynamically
    // Logic: replace slashes with hyphens for the tag prefix
    const tagPrefix = `actions-${packageName}-${subAction}`.replaceAll('/', '-');
    const versioningRegex = String.raw`^${tagPrefix}-v(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$`;

    const newRule: RenovatePackageRule = {
      description: `Versioning for action ${packageName}/${subAction}`,
      matchDepNames: [fullActionName],
      versioning: `regex:${versioningRegex}`,
    };

    // Check if rule already exists to avoid duplicates
    const exists = config.packageRules.some(
      (rule) => rule.matchDepNames?.includes(fullActionName) || rule.matchPackageNames?.includes(fullActionName),
    );

    if (exists) {
      console.log(`Renovate package rule for ${fullActionName} already exists.`);
    } else {
      config.packageRules.push(newRule);
      await this.writeConfig(config);
      console.log(`Added Renovate package rule for ${fullActionName}`);
    }
  }

  /**
   * Removes the package rule for a specific action.
   */
  static async removePackageRule(packageName: string, subAction: string): Promise<void> {
    const config = await this.readConfig();
    const repoName = await getRepoName();
    const fullActionName = `${repoName}/actions/${packageName}/${subAction}`;

    const originalLength = config.packageRules.length;
    config.packageRules = config.packageRules.filter(
      (rule) => !rule.matchDepNames?.includes(fullActionName) && !rule.matchPackageNames?.includes(fullActionName),
    );

    if (config.packageRules.length < originalLength) {
      await this.writeConfig(config);
      console.log(`Removed Renovate package rule for ${fullActionName}`);
    } else {
      console.log(`No Renovate package rule found for ${fullActionName} to remove.`);
    }
  }
}
