import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runGit, runGitText } from 'actions-util/patch';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPatchGit, parseBinaryNumstat, parseTreeLinks } from './git.js';

describe('parseTreeLinks', () => {
  it('keeps only symbolic links and submodules, by path', () => {
    const output = [
      `100644 blob ${'a'.repeat(40)}\tREADME.md`,
      `100755 blob ${'b'.repeat(40)}\tgradlew`,
      `120000 blob ${'c'.repeat(40)}\tdocs/link`,
      `160000 commit ${'d'.repeat(40)}\tvendor/lib`,
      `120000 blob ${'e'.repeat(40)}\twith\ttab`,
      '',
    ].join('\0');

    expect(parseTreeLinks(output)).toEqual(
      new Map([
        ['docs/link', '120000'],
        ['vendor/lib', '160000'],
        ['with\ttab', '120000'],
      ]),
    );
  });
});

describe('parseBinaryNumstat', () => {
  it('returns the paths of binary hunks only', () => {
    expect(parseBinaryNumstat(['1\t0\ttext.txt', '-\t-\timage.png', '0\t3\tgone.txt', ''].join('\0'))).toEqual(
      new Set(['image.png']),
    );
  });

  it('returns both paths of a binary rename, and keeps the records after it aligned', () => {
    const output = ['-\t-\t', 'old.bin', 'new.bin', '-\t-\tnext.bin', '2\t2\t', 'a.txt', 'b.txt', ''].join('\0');

    expect(parseBinaryNumstat(output)).toEqual(new Set(['old.bin', 'new.bin', 'next.bin']));
  });

  it('returns nothing for empty output', () => {
    expect(parseBinaryNumstat('')).toEqual(new Set());
  });
});

describe('createPatchGit', () => {
  let root: string;
  let repo: string;
  let scratch: string;
  let base: string;

  async function git(...args: string[]): Promise<string> {
    return runGitText(args, { cwd: repo });
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'commit-patch-git-'));
    repo = path.join(root, 'repo');
    scratch = path.join(root, 'scratch');
    await mkdir(path.join(repo, 'dir'), { recursive: true });
    await mkdir(scratch);

    await runGit(['init', '--quiet'], { cwd: repo });
    await writeFile(path.join(repo, 'dir/file.txt'), 'one\n');
    await symlink('dir', path.join(repo, 'link'));
    await git('add', '--all');
    await git('-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '--quiet', '-m', 'seed');
    base = await git('rev-parse', 'HEAD');
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  async function patchFile(text: string): Promise<string> {
    const file = path.join(root, 'changes.patch');
    await writeFile(file, text);

    return file;
  }

  it('reports the checkout head', async () => {
    await expect(createPatchGit(repo, scratch).headSha()).resolves.toBe(base);
  });

  it('lists the symbolic links of the base tree', async () => {
    await expect(createPatchGit(repo, scratch).linksInTree(base)).resolves.toEqual(new Map([['link', '120000']]));
  });

  it('applies to a throwaway index, leaving the checkout, its index and the scratch directory clean', async () => {
    const file = await patchFile(
      [
        'diff --git a/dir/file.txt b/dir/file.txt',
        '--- a/dir/file.txt',
        '+++ b/dir/file.txt',
        '@@ -1 +1 @@',
        '-one',
        '+two',
        '',
      ].join('\n'),
    );
    const patchGit = createPatchGit(repo, scratch);

    const changes = await patchGit.applyToScratchIndex(base, file);

    expect(changes).toEqual([expect.objectContaining({ path: 'dir/file.txt', srcMode: '100644', status: 'M' })]);
    expect((await patchGit.readBlob(changes[0]?.dstSha ?? '')).toString('utf8')).toBe('two\n');
    expect(await git('status', '--porcelain')).toBe('');
    expect(await readdir(scratch)).toEqual([]);
  });

  it('fails, and still cleans up, when the patch does not apply', async () => {
    const file = await patchFile(
      [
        'diff --git a/dir/file.txt b/dir/file.txt',
        '--- a/dir/file.txt',
        '+++ b/dir/file.txt',
        '@@ -1 +1 @@',
        '-not there',
        '+two',
        '',
      ].join('\n'),
    );

    await expect(createPatchGit(repo, scratch).applyToScratchIndex(base, file)).rejects.toThrow(/git apply failed/);
    expect(await readdir(scratch)).toEqual([]);
  });

  it('reports binary hunks of a real binary patch', async () => {
    await writeFile(path.join(repo, 'blob.bin'), Buffer.from([0, 1, 2, 3]));
    await git('add', 'blob.bin');
    const text = (await runGit(['diff', '--cached', '--binary', '--full-index'], { cwd: repo })).toString('utf8');
    await git('rm', '--cached', '--quiet', 'blob.bin');

    await expect(createPatchGit(repo, scratch).binaryPathsInPatch(await patchFile(text))).resolves.toEqual(
      new Set(['blob.bin']),
    );
  });
});
