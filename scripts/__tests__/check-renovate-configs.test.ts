import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configFiles, main } from '../check-renovate-configs.js';
import type { CommandRunner } from '../lib/renovate-tool.js';
import { ROOT_DIR } from '../lib/utils.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-renovate-configs-test-'));
  const presets = path.join(root, 'configs', 'renovate');
  fs.mkdirSync(presets, { recursive: true });
  for (const file of ['rust.json', 'base.json', 'README.md']) {
    fs.writeFileSync(path.join(presets, file), '{}');
  }
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('configFiles', () => {
  it('lists renovate.json, then every preset in name order', () => {
    expect(configFiles(root)).toEqual([
      'renovate.json',
      path.join('configs', 'renovate', 'base.json'),
      path.join('configs', 'renovate', 'rust.json'),
    ]);
  });

  it('covers every shipped preset', () => {
    const shipped = fs.readdirSync(path.join(ROOT_DIR, 'configs', 'renovate')).filter((file) => file.endsWith('.json'));

    expect(configFiles()).toHaveLength(shipped.length + 1);
  });
});

describe('pinned Renovate', () => {
  const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(path.join(ROOT_DIR, file), 'utf8'));

  const parseVersion = (version: string): number[] => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    return version.split('.').map(Number);
  };

  const compareVersions = (a: number[], b: number[]): number =>
    a.reduce((order, part, index) => order || part - b[index], 0);

  it('never runs ahead of the cap that tracks the Mend-hosted release', () => {
    const tool = readJson('.github/tools/renovate/package.json') as { devDependencies: Record<string, string> };
    const config = readJson('renovate.json') as {
      packageRules: { matchFileNames?: string[]; matchPackageNames?: string[]; allowedVersions?: string }[];
    };

    const caps = config.packageRules.filter(
      (rule) =>
        rule.matchFileNames?.includes('.github/tools/renovate/package.json') &&
        rule.matchPackageNames?.includes('renovate') &&
        rule.allowedVersions !== undefined,
    );
    expect(caps).toHaveLength(1);

    const cap = /^<=(\d+\.\d+\.\d+)$/.exec(caps[0].allowedVersions ?? '');
    expect(cap, 'allowedVersions must be an inclusive cap of the form <=x.y.z').not.toBeNull();

    const pin = parseVersion(tool.devDependencies.renovate);
    expect(compareVersions(pin, parseVersion(cap?.[1] ?? ''))).toBeLessThanOrEqual(0);
  });
});

describe('main', () => {
  it('runs the validator strictly, as repository config, over every file', async () => {
    const run = vi.fn<CommandRunner>().mockResolvedValue({ exitCode: 0, output: '' });

    expect(await main({ rootDir: root, validator: () => '/validator.js', run })).toBe(0);
    expect(run).toHaveBeenCalledWith(['node', '/validator.js', '--strict', '--no-global', ...configFiles(root)], {
      cwd: root,
      inherit: true,
    });
    expect(console.log).toHaveBeenCalledWith('✅ 3 Renovate config(s) are valid.');
  });

  it('passes the validator exit code through on failure', async () => {
    const run = vi.fn<CommandRunner>().mockResolvedValue({ exitCode: 1, output: '' });

    expect(await main({ rootDir: root, validator: () => '/validator.js', run })).toBe(1);
    expect(console.error).toHaveBeenCalledWith('❌ Renovate config validation failed (exit code 1).');
  });
});
