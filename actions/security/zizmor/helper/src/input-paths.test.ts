import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { UnsafePathError } from 'actions-util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InvalidInputError } from './errors.js';
import { containerArgument, resolveAuditInputs, resolveConfigPath } from './input-paths.js';

let workspace: string;
let outside: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'zizmor-paths-'));
  outside = await mkdtemp(join(tmpdir(), 'zizmor-outside-'));
  await mkdir(join(workspace, '.github', 'workflows'), { recursive: true });
  await writeFile(join(workspace, '.github', 'workflows', 'ci.yml'), 'on: push\n');
  await writeFile(join(workspace, '.github', 'zizmor.yml'), 'rules: {}\n');
  await writeFile(join(workspace, '-weird.yml'), 'on: push\n');
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

async function linksSupported(): Promise<boolean> {
  try {
    await symlink(outside, join(workspace, 'probe'), 'dir');
    await rm(join(workspace, 'probe'));

    return true;
  } catch {
    return false;
  }
}

describe('containerArgument', () => {
  it('spells the workspace root as .', () => {
    expect(containerArgument(workspace, workspace)).toBe('.');
  });

  it('uses / whatever the host separator is', () => {
    expect(containerArgument(workspace, join(workspace, '.github', 'workflows'))).toBe('.github/workflows');
  });

  it('puts ./ in front of a name that begins with a dash, so - never means standard input', () => {
    expect(containerArgument(workspace, join(workspace, '-'))).toBe('./-');
    expect(containerArgument(workspace, join(workspace, '-weird.yml'))).toBe('./-weird.yml');
  });
});

describe('resolveAuditInputs', () => {
  it('resolves a directory and a file, and keeps a path written twice once', async () => {
    const inputs = await resolveAuditInputs(['.', './', '.github/workflows/ci.yml'], workspace);

    expect(inputs).toEqual([
      { argument: '.', absolute: resolve(workspace), directory: true },
      {
        argument: '.github/workflows/ci.yml',
        absolute: resolve(workspace, '.github/workflows/ci.yml'),
        directory: false,
      },
    ]);
  });

  it('keeps the ./ on a file that begins with a dash', async () => {
    const [input] = await resolveAuditInputs(['./-weird.yml'], workspace);

    expect(input?.argument).toBe('./-weird.yml');
  });

  it('refuses a missing path, which zizmor would fetch as a repository slug', async () => {
    const error = await resolveAuditInputs(['zizmorcore/zizmor'], workspace).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as Error).message).toContain('owner/repo');
  });

  it.each(['../outside', '/etc', 'a/../../b', 'C:/Windows'])('refuses %j, which leaves the workspace', async (path) => {
    await expect(resolveAuditInputs([path], workspace)).rejects.toBeInstanceOf(UnsafePathError);
  });

  it('refuses a committed link that leads out of the workspace', async (context) => {
    if (!(await linksSupported())) {
      context.skip();
    }

    await symlink(outside, join(workspace, 'escape'), 'dir');

    await expect(resolveAuditInputs(['escape'], workspace)).rejects.toBeInstanceOf(UnsafePathError);
  });
});

describe('resolveConfigPath', () => {
  it('resolves a file in the workspace as zizmor receives it', async () => {
    await expect(resolveConfigPath('.github/zizmor.yml', workspace)).resolves.toBe('.github/zizmor.yml');
  });

  it.each(['.github', 'missing.yml'])('refuses %j, which is not a file', async (path) => {
    await expect(resolveConfigPath(path, workspace)).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('refuses a path outside the workspace', async () => {
    await expect(resolveConfigPath('../zizmor.yml', workspace)).rejects.toBeInstanceOf(UnsafePathError);
  });
});
