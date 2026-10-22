import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RENOVATE_INSTALL_COMMAND, RENOVATE_TOOL_DIR, renovateEntry, runCommand } from '../renovate-tool.js';
import { ROOT_DIR } from '../utils.js';

let toolDir: string;

beforeEach(() => {
  toolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovate-tool-test-'));
});

afterEach(() => {
  fs.rmSync(toolDir, { recursive: true, force: true });
});

describe('renovateEntry', () => {
  it('resolves an installed entry point', () => {
    const file = path.join(toolDir, 'node_modules', 'renovate', 'dist', 'config-validator.js');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');

    expect(renovateEntry('config-validator', toolDir)).toBe(file);
  });

  it('names the install command when Renovate is missing', () => {
    expect(() => renovateEntry('renovate', toolDir)).toThrow(RENOVATE_INSTALL_COMMAND);
  });

  it('points at the pinned tool package', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(RENOVATE_TOOL_DIR, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };

    expect(path.relative(ROOT_DIR, RENOVATE_TOOL_DIR)).toBe(path.join('.github', 'tools', 'renovate'));
    // An exact version: a range would let two runs of the same commit validate with different Renovates.
    expect(manifest.devDependencies.renovate).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('runCommand', () => {
  it('captures stdout then stderr, the exit code and the extra environment', async () => {
    const result = await runCommand(
      [
        process.execPath,
        '-e',
        'process.stdout.write(process.env.EXTRA + " " + process.cwd()); process.stderr.write("!"); process.exit(3)',
      ],
      { cwd: toolDir, env: { EXTRA: 'set' } },
    );

    expect(result.exitCode).toBe(3);
    expect(result.output).toBe(`set ${fs.realpathSync(toolDir)}!`);
  });

  it('captures nothing when the output is inherited', async () => {
    const result = await runCommand([process.execPath, '-e', ''], { cwd: toolDir, inherit: true });

    expect(result).toEqual({ exitCode: 0, output: '' });
  });

  it('rejects when the executable does not exist', async () => {
    await expect(runCommand(['definitely-not-a-command-4f1c'], { cwd: toolDir })).rejects.toThrow();
  });
});
