import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  collectCandidates,
  findByteOrderMarks,
  gitIgnoreFilter,
  isCollectedAndBomSensitive,
  runWithInput,
  startsWithByteOrderMark,
} from './bom.js';

import type { AuditInput } from './input-paths.js';

const BOM = '\uFEFF';
const WORKFLOW = 'on: push\njobs: {}\n';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'zizmor-bom-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function write(files: Record<string, string>): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(workspace, path)), { recursive: true });
    await writeFile(join(workspace, path), contents, 'utf8');
  }
}

function directory(path = '.'): AuditInput {
  return { argument: path, absolute: join(workspace, path), directory: true };
}

function file(path: string): AuditInput {
  return { argument: path, absolute: join(workspace, path), directory: false };
}

const noneIgnored = (): Promise<Set<string>> => Promise.resolve(new Set());

describe('isCollectedAndBomSensitive', () => {
  it.each([
    ['.github/workflows/ci.yml', true],
    ['.github/workflows/ci.yaml', true],
    ['nested/repo/.github/workflows/ci.yml', true],
    ['action.yml', true],
    ['actions/a/b/action.yaml', true],
    ['.github/dependabot.yml', true],
    ['sub/.github/dependabot.yaml', true],
    ['.pre-commit-hooks.yaml', true],
    // Measured against zizmor 1.30.1: none of these is collected, or a BOM in it is tolerated.
    ['.github/workflows/nested/deep.yml', false],
    ['.github/workflows/ci.YML', false],
    ['.github/workflows/README.md', false],
    ['Action.yml', false],
    ['dependabot.yml', false],
    ['workflows/release/workflow.yaml', false],
    ['docker-compose.yml', false],
    ['.pre-commit-config.yaml', false],
  ])('%s: %s', (path, expected) => {
    expect(isCollectedAndBomSensitive(path.split('/'))).toBe(expected);
  });
});

describe('startsWithByteOrderMark', () => {
  it.each([
    [`${BOM}${WORKFLOW}`, true],
    [WORKFLOW, false],
    ['', false],
    ['\u00EF', false],
    [`\n${BOM}`, false],
  ])('%j: %s', async (contents, expected) => {
    await write({ 'f.yml': contents });

    await expect(startsWithByteOrderMark(join(workspace, 'f.yml'))).resolves.toBe(expected);
  });
});

describe('collectCandidates', () => {
  it('walks the whole tree, skipping .git, and returns only what zizmor collects', async () => {
    await write({
      '.github/workflows/ci.yml': WORKFLOW,
      'sub/action.yml': WORKFLOW,
      '.git/hooks/action.yml': WORKFLOW,
      'docker-compose.yml': WORKFLOW,
    });

    await expect(collectCandidates(workspace, workspace)).resolves.toEqual([
      join(workspace, '.github/workflows/ci.yml'),
      join(workspace, 'sub/action.yml'),
    ]);
  });

  it('judges a path from the workspace root, so a walk rooted at .github/workflows still collects', async () => {
    await write({ '.github/workflows/ci.yml': WORKFLOW });

    await expect(collectCandidates(join(workspace, '.github/workflows'), workspace)).resolves.toEqual([
      join(workspace, '.github/workflows/ci.yml'),
    ]);
  });

  it('neither follows nor returns a symbolic link', async (context) => {
    const outside = await mkdtemp(join(tmpdir(), 'zizmor-bom-outside-'));

    try {
      await writeFile(join(outside, 'action.yml'), `${BOM}${WORKFLOW}`);

      try {
        await symlink(outside, join(workspace, 'linked'), 'dir');
        await symlink(join(outside, 'action.yml'), join(workspace, 'action.yml'), 'file');
      } catch {
        context.skip();
      }

      await expect(collectCandidates(workspace, workspace)).resolves.toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('findByteOrderMarks', () => {
  it('reports every marked file under a directory, sorted, as workspace paths with /', async () => {
    await write({
      '.github/workflows/b.yml': `${BOM}${WORKFLOW}`,
      '.github/workflows/a.yml': `${BOM}${WORKFLOW}`,
      '.github/workflows/clean.yml': WORKFLOW,
      'sub/action.yaml': `${BOM}${WORKFLOW}`,
    });

    await expect(findByteOrderMarks([directory()], workspace, noneIgnored)).resolves.toEqual([
      '.github/workflows/a.yml',
      '.github/workflows/b.yml',
      'sub/action.yaml',
    ]);
  });

  it('checks a named file whatever its name, and never filters it as ignored', async () => {
    await write({ 'fixtures/odd-name.yml': `${BOM}${WORKFLOW}` });

    const ignoreEverything = (_: string, paths: readonly string[]): Promise<Set<string>> =>
      Promise.resolve(new Set(paths));

    await expect(findByteOrderMarks([file('fixtures/odd-name.yml')], workspace, ignoreEverything)).resolves.toEqual([
      'fixtures/odd-name.yml',
    ]);
  });

  it('ignores a BOM in a file zizmor does not collect', async () => {
    await write({ 'docker-compose.yml': `${BOM}${WORKFLOW}`, 'workflows/x/workflow.yaml': `${BOM}${WORKFLOW}` });

    await expect(findByteOrderMarks([directory()], workspace, noneIgnored)).resolves.toEqual([]);
  });

  it('reports a file reached by two inputs once', async () => {
    await write({ '.github/workflows/a.yml': `${BOM}${WORKFLOW}` });

    await expect(
      findByteOrderMarks([directory(), directory('.github'), file('.github/workflows/a.yml')], workspace, noneIgnored),
    ).resolves.toEqual(['.github/workflows/a.yml']);
  });

  it('drops what the ignore filter reports', async () => {
    await write({ 'vendor/action.yml': `${BOM}${WORKFLOW}`, 'action.yml': `${BOM}${WORKFLOW}` });

    const ignoreVendor = (_: string, paths: readonly string[]): Promise<Set<string>> =>
      Promise.resolve(new Set(paths.filter((path) => path.startsWith('vendor/'))));

    await expect(findByteOrderMarks([directory()], workspace, ignoreVendor)).resolves.toEqual(['action.yml']);
  });
});

describe('gitIgnoreFilter', () => {
  it('reports nothing as ignored outside a repository', async () => {
    await write({ '.gitignore': 'vendor/\n' });

    await expect(gitIgnoreFilter(workspace, ['vendor/action.yml'])).resolves.toEqual(new Set());
  });

  it('applies .gitignore by pattern inside a repository, tracked or not', async () => {
    execFileSync('git', ['init', '--quiet', workspace]);
    await write({ '.gitignore': 'vendor/\n*.local.yml\n' });

    await expect(
      gitIgnoreFilter(workspace, ['vendor/action.yml', 'a b/action.local.yml', 'action.yml']),
    ).resolves.toEqual(new Set(['vendor/action.yml', 'a b/action.local.yml']));
  });

  it('asks git nothing for no paths', async () => {
    await expect(gitIgnoreFilter(join(workspace, 'missing'), [])).resolves.toEqual(new Set());
  });

  // Git refuses a non-repository before reading stdin; more than a pipe buffer of paths makes the
  // write fail with EPIPE, which crashed the helper on Linux runners.
  it('reports nothing as ignored outside a repository, however many paths it is given', async () => {
    const paths = Array.from({ length: 20_000 }, (_, index) => `.github/workflows/${index}.yml`);

    await expect(gitIgnoreFilter(workspace, paths)).resolves.toEqual(new Set());
  });
});

describe('runWithInput', () => {
  it('returns the exit code and stdout of a command that reads its input', async () => {
    const script = 'process.stdin.pipe(process.stdout)';

    await expect(runWithInput(process.execPath, ['-e', script], Buffer.from('a\0b'), workspace)).resolves.toEqual({
      exitCode: 0,
      stdout: 'a\0b',
    });
  });

  it('survives a command that exits without reading a large input', async () => {
    const input = Buffer.alloc(8 * 1024 * 1024, 'x');

    await expect(runWithInput(process.execPath, ['-e', 'process.exit(3)'], input, workspace)).resolves.toEqual({
      exitCode: 3,
      stdout: '',
    });
  });

  it('answers undefined for a command that cannot be started', async () => {
    await expect(runWithInput('zizmor-test-no-such-command', [], Buffer.alloc(0), workspace)).resolves.toBeUndefined();
  });
});
