import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { METADATA_FILE_NAME, parseMetadata, PATCH_FILE_NAME, runGit, runGitText, sha256Hex } from 'actions-util/patch';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPatch, PatchTooLargeError } from './patch.js';

import type { CreatePatchRequest } from './patch.js';

let root: string;
let repo: string;
let output: string;

/** Runs git in the fixture repository. */
function git(...args: string[]): Promise<string> {
  return runGitText(args, { cwd: repo });
}

async function write(files: Record<string, string | Buffer>): Promise<void> {
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(repo, file)), { recursive: true });
    await writeFile(path.join(repo, file), contents);
  }
}

/** Initialises a repository holding `files` in a single commit, and returns that commit. */
async function seed(files: Record<string, string | Buffer>): Promise<string> {
  await runGit(['init', '--quiet', '--initial-branch=main'], { cwd: repo });
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test');
  await git('config', 'commit.gpgsign', 'false');
  await write(files);
  await git('add', '--all');
  await git('commit', '--quiet', '--allow-empty', '-m', 'seed');

  return git('rev-parse', 'HEAD');
}

function request(overrides: Partial<CreatePatchRequest> = {}): CreatePatchRequest {
  return {
    maxPatchBytes: 1024 * 1024,
    outputDirectory: output,
    paths: '.',
    scratchRoot: root,
    workspace: repo,
    ...overrides,
  };
}

async function patchText(): Promise<string> {
  return readFile(path.join(output, PATCH_FILE_NAME), 'utf8');
}

/** Applies the written patch to a fresh clone at the base, and returns the clone's porcelain status. */
async function applyToClone(base: string): Promise<{ clone: string; status: string }> {
  const clone = path.join(root, 'clone');
  await runGit(['clone', '--quiet', '--no-checkout', repo, clone], { cwd: root });
  await runGit(['checkout', '--quiet', base], { cwd: clone });
  await runGit(['apply', path.join(output, PATCH_FILE_NAME)], { cwd: clone });

  // Not runGitText: trimming would eat the leading space of the first ` M` record.
  const status = (await runGit(['status', '--porcelain', '-uall'], { cwd: clone })).toString('utf8').trimEnd();

  return { clone, status };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'create-patch-'));
  repo = path.join(root, 'repo');
  output = path.join(root, 'out');
  await mkdir(repo);
  await mkdir(output);
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe('createPatch', () => {
  it('writes an empty patch and has_changes false for a clean tree', async () => {
    const base = await seed({ 'a.txt': 'a\n' });

    const metadata = await createPatch(request());

    expect(metadata).toMatchObject({ baseSha: base, hasChanges: false, patchBytes: 0 });
    expect(await patchText()).toBe('');
    expect(parseMetadata(await readFile(path.join(output, METADATA_FILE_NAME), 'utf8'))).toEqual(metadata);
  });

  it('records modified, deleted and untracked files, and the patch applies to the base', async () => {
    const base = await seed({ 'keep.txt': 'old\n', 'gone.txt': 'bye\n' });
    await write({ 'keep.txt': 'new\n', 'dir/added.txt': 'hello\n' });
    await rm(path.join(repo, 'gone.txt'));

    const metadata = await createPatch(request());

    expect(metadata.hasChanges).toBe(true);
    expect(metadata.patchSha256).toBe(sha256Hex(await readFile(path.join(output, PATCH_FILE_NAME))));

    const { clone, status } = await applyToClone(base);
    expect(status.split('\n').sort()).toEqual([' D gone.txt', ' M keep.txt', '?? dir/added.txt']);
    expect(await readFile(path.join(clone, 'dir/added.txt'), 'utf8')).toBe('hello\n');
  });

  it('leaves out ignored files', async () => {
    await seed({ '.gitignore': 'node_modules/\n' });
    await write({ 'node_modules/pkg/index.js': 'x\n', 'kept.txt': 'y\n' });

    await createPatch(request());

    const text = await patchText();
    expect(text).toContain('b/kept.txt');
    expect(text).not.toContain('node_modules');
  });

  it('scopes the patch to the given paths, globs crossing directories', async () => {
    await seed({ 'src/a.ts': '1\n', 'dist/a.js': '1\n', 'README.md': '1\n' });
    await write({ 'src/a.ts': '2\n', 'dist/a.js': '2\n', 'dist/deep/b.js': '2\n', 'README.md': '2\n' });

    await createPatch(request({ paths: 'dist/**/*.js\nREADME.md' }));

    const text = await patchText();
    expect(text).toContain('b/dist/a.js');
    expect(text).toContain('b/dist/deep/b.js');
    expect(text).toContain('b/README.md');
    expect(text).not.toContain('src/a.ts');
  });

  it('treats a pathspec that matches nothing as no changes, not an error', async () => {
    await seed({ 'a.txt': 'a\n' });
    await write({ 'a.txt': 'b\n' });

    await expect(createPatch(request({ paths: 'generated/**' }))).resolves.toMatchObject({ hasChanges: false });
  });

  it('records each rename as a deletion and an addition', async () => {
    await seed({ 'old.txt': 'same\n' });
    await git('mv', 'old.txt', 'new.txt');

    await createPatch(request());

    const text = await patchText();
    expect(text).not.toContain('rename from');
    expect(text).toContain('deleted file mode 100644');
    expect(text).toContain('new file mode 100644');
  });

  it('encodes binary content as an applicable binary patch', async () => {
    const base = await seed({});
    const bytes = Buffer.from([0, 1, 2, 255, 0, 10]);
    await write({ 'image.bin': bytes });

    await createPatch(request());

    expect(await patchText()).toContain('GIT binary patch');
    const { clone } = await applyToClone(base);
    expect((await readFile(path.join(clone, 'image.bin'))).equals(bytes)).toBe(true);
  });

  it('ignores an executable-bit flip, and records a new executable as a regular file', async () => {
    await seed({ 'script.sh': 'echo\n' });
    await chmod(path.join(repo, 'script.sh'), 0o755);
    await write({ 'tool.sh': 'echo\n' });
    await chmod(path.join(repo, 'tool.sh'), 0o755);

    await createPatch(request());

    const text = await patchText();
    expect(text).not.toContain('script.sh');
    expect(text).toContain('new file mode 100644');
    expect(text).not.toContain('100755');
  });

  it('records a new symbolic link as one, for commit-patch to refuse', async () => {
    await seed({ 'target.txt': 't\n' });
    await symlink('target.txt', path.join(repo, 'link'));

    await createPatch(request());

    expect(await patchText()).toContain('new file mode 120000');
  });

  it('leaves the checkout index and working tree untouched', async () => {
    await seed({ 'a.txt': 'a\n' });
    await write({ 'a.txt': 'b\n', 'new.txt': 'n\n' });
    const before = await git('status', '--porcelain', '-uall');

    await createPatch(request());

    expect(await git('status', '--porcelain', '-uall')).toBe(before);
    expect(await git('diff', '--cached', '--name-only')).toBe('');
  });

  it('fails when the patch exceeds the size limit, and writes nothing', async () => {
    await seed({});
    await write({ 'big.txt': 'x'.repeat(10_000) });

    await expect(createPatch(request({ maxPatchBytes: 1000 }))).rejects.toBeInstanceOf(PatchTooLargeError);
    await expect(readFile(path.join(output, PATCH_FILE_NAME))).rejects.toThrow();
  });

  it('fails outside a repository with a commit', async () => {
    await runGit(['init', '--quiet'], { cwd: repo });

    await expect(createPatch(request())).rejects.toThrow(/git rev-parse failed/);
  });

  it('removes its throwaway index', async () => {
    await seed({ 'a.txt': 'a\n' });

    await createPatch(request());

    expect((await readdir(root)).sort()).toEqual(['out', 'repo']);
  });
});
