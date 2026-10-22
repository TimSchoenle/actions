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
