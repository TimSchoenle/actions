import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildActions, main, selectBuildSet } from '../build-actions';

import type { BuildActionsContext, CommandRunner } from '../build-actions';

let root: string;

function write(file: string, content: string): void {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

const NODE_ACTION = "runs:\n  using: 'node24'\n  main: 'dist/index.js'\n";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), 'build-actions-'));
  write('actions/a/one/action.yaml', NODE_ACTION);
  write(
    'actions/a/two/action.yaml',
    'runs:\n  using: composite\n  steps:\n    - shell: bash\n      run: node "$GITHUB_ACTION_PATH/helper/dist/index.js"\n',
  );
  write('actions/a/two/helper/action.yaml', NODE_ACTION);
  write('actions/a/three/action.yaml', 'runs:\n  using: composite\n  steps:\n    - uses: ./actions/a/one\n');
  write('scripts/templates/action/action.yaml', '{{ template }}');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** A runner that "builds" by writing the bundle the directory's manifest names. */
function fakeBuild(exitCode = 0): CommandRunner & ReturnType<typeof vi.fn> {
  return vi.fn(async (_command: string[], cwd: string) => {
    if (exitCode === 0) {
      fs.mkdirSync(path.join(cwd, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(cwd, 'dist', 'index.js'), 'built');
    }

    return { exitCode, stderr: exitCode === 0 ? '' : 'compile error' };
  });
}

function context(run: CommandRunner): BuildActionsContext {
  return { root, run, log: () => undefined };
}

describe('selectBuildSet', () => {
  it('selects every action under actions/ for --all, and nothing outside it', () => {
    expect(selectBuildSet(['--all'], root).buildDirs).toEqual(['actions/a/one', 'actions/a/two/helper']);
  });

  it('selects the closure of the given actions', () => {
    expect(selectBuildSet(['./actions/a/three'], root).buildDirs).toEqual(['actions/a/one']);
  });

  it.each([[[]], [['--all', 'actions/a/one']]])('rejects %j', (argv) => {
    expect(() => selectBuildSet(argv, root)).toThrow(/Pass --all or one or more action directories/);
  });
});

describe('buildActions', () => {
  it("runs each build directory's build script and returns the bundles", async () => {
    const run = fakeBuild();

    await expect(buildActions(selectBuildSet(['--all'], root), context(run))).resolves.toEqual([
      'actions/a/one/dist/index.js',
      'actions/a/two/helper/dist/index.js',
    ]);
    expect(run.mock.calls.map(([command, cwd]) => [command, path.relative(root, cwd).replaceAll('\\', '/')])).toEqual([
      [['bun', 'run', 'build'], 'actions/a/one'],
      [['bun', 'run', 'build'], 'actions/a/two/helper'],
    ]);
  });

  it('names the directory whose build failed', async () => {
    await expect(buildActions(selectBuildSet(['actions/a/one'], root), context(fakeBuild(2)))).rejects.toThrow(
      /actions\/a\/one: 'bun run build' failed with exit code 2\.\ncompile error/,
    );
  });

  it('names a bundle the build script did not produce', async () => {
    const run: CommandRunner = async () => ({ exitCode: 0, stderr: '' });

    await expect(buildActions(selectBuildSet(['actions/a/one'], root), context(run))).rejects.toThrow(
      /did not produce: actions\/a\/one\/dist\/index\.js/,
    );
  });
});

describe('main', () => {
  it('reports success and failure through the exit code', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(main(['--all'], context(fakeBuild()))).resolves.toBe(0);
    await expect(main([], context(fakeBuild()))).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Pass --all'));

    error.mockRestore();
  });
});
