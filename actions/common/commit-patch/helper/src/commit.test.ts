import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describePatch, runGit, runGitText, serializeMetadata } from 'actions-util/patch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commitPatch, PatchPolicyError } from './commit.js';
import { createPatchGit } from './git.js';
import { compileAllowlist } from './glob.js';

import type { CommitPatchDeps, CommitPatchRequest } from './commit.js';
import type { CommitApi, CreateCommitRequest } from 'actions-util/commit-on-branch';

/**
 * These cases run the real git plumbing against a real repository, and fake only GitHub.
 *
 * The policy is unit-tested on its own; what matters here is that a patch is judged by what git
 * actually does with it. Several patches below are hand-written to say one thing and do another, or
 * to reach a path git itself should refuse, and every one of them must end without a commit.
 */

let root: string;
/** The checkout the privileged job holds, at the base commit. */
let repo: string;
/** A clone standing in for the unprivileged job that produced the patch. */
let producer: string;
let download: string;
let base: string;

function git(cwd: string, ...args: string[]): Promise<string> {
  return runGitText(args, { cwd });
}

async function write(directory: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), contents);
  }
}

async function seed(files: Record<string, string | Buffer>, prepare?: (dir: string) => Promise<void>): Promise<void> {
  await runGit(['init', '--quiet', '--initial-branch=main'], { cwd: repo });
  await git(repo, 'config', 'user.email', 't@example.com');
  await git(repo, 'config', 'user.name', 'T');
  await write(repo, files);
  await prepare?.(repo);
  await git(repo, 'add', '--all');
  await git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'seed');
  base = await git(repo, 'rev-parse', 'HEAD');
  await runGit(['clone', '--quiet', repo, producer], { cwd: root });
}

/** Lays out the artifact download-artifact would have extracted, holding `patch` made at `baseSha`. */
async function artifact(patch: string | Buffer, baseSha = base): Promise<void> {
  const bytes = Buffer.isBuffer(patch) ? patch : Buffer.from(patch);
  await writeFile(path.join(download, 'changes.patch'), bytes);
  await writeFile(path.join(download, 'metadata.json'), serializeMetadata(describePatch(baseSha, bytes)));
}

/** Diffs the producer's tree against the base the way create-patch does, renames optional. */
async function producedPatch(renames = false): Promise<Buffer> {
  await git(producer, 'add', '--all');

  return runGit(
    [
      'diff',
      '--cached',
      '--binary',
      '--full-index',
      renames ? '-M' : '--no-renames',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      base,
    ],
    { cwd: producer },
  );
}

function fakeApi(head: () => string = () => base): CommitApi & { created: CreateCommitRequest[] } {
  const created: CreateCommitRequest[] = [];

  return {
    createCommit: vi.fn(async (request: CreateCommitRequest) => {
      created.push(request);
      return { oid: 'c'.repeat(40), url: 'https://github.com/o/r/commit/ccc' };
    }),
    created,
    getHeadOid: vi.fn(async () => head()),
  };
}

let api: ReturnType<typeof fakeApi>;
let notices: string[];

function deps(overrides: Partial<CommitPatchDeps> = {}): CommitPatchDeps {
  return {
    api,
    git: createPatchGit(repo, root),
    info: () => {},
    notice: (message) => notices.push(message),
    ...overrides,
  };
}

function request(
  overrides: Partial<CommitPatchRequest> & {
    allowed?: string;
    allowWorkflowChanges?: boolean;
    allowBinary?: boolean;
  } = {},
): CommitPatchRequest {
  const { allowBinary = false, allowed = '**', allowWorkflowChanges = false, ...rest } = overrides;

  return {
    branch: 'feature',
    directory: download,
    expectedHeadSha: base,
    maxPatchBytes: 1024 * 1024,
    message: 'build: update',
    policy: { allowBinary, allowWorkflowChanges, allowlist: compileAllowlist(allowed) },
    repository: 'owner/repo',
    ...rest,
  };
}

/** The committed content of each added path, decoded, plus the deleted paths. */
function committed(): { additions: Record<string, string>; deletions: string[] } {
  const [commit] = api.created;
  const additions = Object.fromEntries(
    (commit?.fileChanges.additions ?? []).map(({ contents, path: file }) => [
      file,
      Buffer.from(contents, 'base64').toString('utf8'),
    ]),
  );

  return { additions, deletions: (commit?.fileChanges.deletions ?? []).map(({ path: file }) => file) };
}

/** Asserts the run was refused for `path` with a reason matching `reason`, and nothing was written. */
async function expectRefused(run: Promise<unknown>, reason: RegExp | typeof PatchPolicyError): Promise<void> {
  await expect(run).rejects.toThrow(reason);
  expect(api.createCommit).not.toHaveBeenCalled();
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'commit-patch-'));
  repo = path.join(root, 'repo');
  producer = path.join(root, 'producer');
  download = path.join(root, 'download');
  await mkdir(repo);
  await mkdir(download);
  api = fakeApi();
  notices = [];
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe('commitPatch', () => {
  describe('a well-formed patch', () => {
    it('commits additions, modifications and deletions, read from the object store, against the base', async () => {
      await seed({ 'dist/a.js': 'old\n', 'dist/gone.js': 'bye\n' });
      await write(producer, { 'dist/a.js': 'new\n', 'dist/deep/b.js': 'added\n' });
      await rm(path.join(producer, 'dist/gone.js'));
      await artifact(await producedPatch());

      const result = await commitPatch(deps(), request({ allowed: 'dist/**' }));

      expect(result).toEqual({
        commitSha: 'c'.repeat(40),
        commitUrl: 'https://github.com/o/r/commit/ccc',
        outcome: 'committed',
      });
      expect(committed()).toEqual({
        additions: { 'dist/a.js': 'new\n', 'dist/deep/b.js': 'added\n' },
        deletions: ['dist/gone.js'],
      });
      expect(api.created[0]).toMatchObject({
        branch: 'feature',
        coordinates: { owner: 'owner', repo: 'repo' },
        expectedHeadOid: base,
        message: 'build: update',
      });
    });

    it('never writes to the checkout', async () => {
      await seed({ 'a.txt': 'a\n' });
      await write(producer, { 'a.txt': 'b\n' });
      await artifact(await producedPatch());

      await commitPatch(deps(), request());

      expect(await git(repo, 'status', '--porcelain', '-uall')).toBe('');
    });

    it('commits a binary file byte for byte when allow_binary is true', async () => {
      await seed({});
      const bytes = Buffer.from([0, 255, 1, 254, 0]);
      await write(producer, { 'logo.png': bytes });
      await artifact(await producedPatch());

      await commitPatch(deps(), request({ allowBinary: true }));

      expect(Buffer.from(api.created[0]?.fileChanges.additions[0]?.contents ?? '', 'base64').equals(bytes)).toBe(true);
    });

    it('commits an allowlisted workflow change when allow_workflow_changes is true', async () => {
      await seed({ '.github/workflows/verify-action-x.yaml': 'on: push\n' });
      await write(producer, { '.github/workflows/verify-action-x.yaml': 'on: pull_request\n' });
      await artifact(await producedPatch());

      await commitPatch(
        deps(),
        request({ allowWorkflowChanges: true, allowed: '.github/workflows/verify-action-*.yaml' }),
      );

      expect(committed().additions).toEqual({ '.github/workflows/verify-action-x.yaml': 'on: pull_request\n' });
    });

    it('decomposes a rename inside the allowlist into a deletion and an addition', async () => {
      await seed({ 'dist/old.js': 'same content here\n' });
      await git(producer, 'mv', 'dist/old.js', 'dist/new.js');
      await artifact(await producedPatch(true));

      await commitPatch(deps(), request({ allowed: 'dist/**' }));

      expect(committed()).toEqual({ additions: { 'dist/new.js': 'same content here\n' }, deletions: ['dist/old.js'] });
    });
  });

  describe('nothing to commit', () => {
    it('reports no_changes for an empty patch without touching git or GitHub', async () => {
      await seed({ 'a.txt': 'a\n' });
      await artifact('');
      const patchGit = createPatchGit(repo, root);
      const headSha = vi.spyOn(patchGit, 'headSha');

      await expect(commitPatch(deps({ git: patchGit }), request())).resolves.toEqual({ outcome: 'no_changes' });
      expect(headSha).not.toHaveBeenCalled();
      expect(api.getHeadOid).not.toHaveBeenCalled();
    });

    it('reports no_changes for a patch that changes nothing once applied', async () => {
      await seed({ 'a.txt': 'a\n' });
      await artifact(
        ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1 +1 @@', '-a', '+a', ''].join('\n'),
      );

      await expect(commitPatch(deps(), request())).resolves.toEqual({ outcome: 'no_changes' });
      expect(api.createCommit).not.toHaveBeenCalled();
    });
  });

  describe('the branch moved', () => {
    it('skips with a notice when the patch was made from another commit', async () => {
      await seed({ 'a.txt': 'a\n' });
      await write(producer, { 'a.txt': 'b\n' });
      await artifact(await producedPatch(), 'f'.repeat(40));

      await expect(commitPatch(deps(), request())).resolves.toEqual({ outcome: 'branch_moved' });
      expect(notices).toEqual([expect.stringContaining(`computed against ${'f'.repeat(40)}`)]);
      expect(api.createCommit).not.toHaveBeenCalled();
    });

    it('skips with a notice when the branch is no longer at the expected head', async () => {
      await seed({ 'a.txt': 'a\n' });
      await write(producer, { 'a.txt': 'b\n' });
      await artifact(await producedPatch());
      api = fakeApi(() => 'e'.repeat(40));

      await expect(commitPatch(deps(), request())).resolves.toEqual({ outcome: 'branch_moved' });
      expect(notices).toEqual([expect.stringContaining(`is at ${'e'.repeat(40)}`)]);
      expect(api.createCommit).not.toHaveBeenCalled();
    });

    it('fails when the checkout is not at the expected head', async () => {
      await seed({ 'a.txt': 'a\n' });
      await write(producer, { 'a.txt': 'b\n' });
      await artifact(await producedPatch());
      await git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'moved');

      await expectRefused(commitPatch(deps(), request()), /The checkout is at .+, not at the expected head/);
    });
  });

  describe('a patch outside the policy', () => {
    it('refuses a change outside the allowlist, listing every offending path', async () => {
      await seed({ 'dist/a.js': '1\n', 'src/a.ts': '1\n' });
      await write(producer, { 'dist/a.js': '2\n', 'src/a.ts': '2\n', 'package.json': '{}\n' });
      await artifact(await producedPatch());

      const run = commitPatch(deps(), request({ allowed: 'dist/**' }));

      await expectRefused(run, PatchPolicyError);
      await expect(run).rejects.toMatchObject({
        violations: [
          { path: 'package.json', reason: 'the path matches no allowed_paths pattern' },
          { path: 'src/a.ts', reason: 'the path matches no allowed_paths pattern' },
        ],
      });
    });

    it('refuses a rename whose destination is outside the allowlist', async () => {
      await seed({ 'dist/a.js': 'moved content\n' });
      await mkdir(path.join(producer, 'src'));
      await git(producer, 'mv', 'dist/a.js', 'src/a.js');
      const patch = await producedPatch(true);
      expect(patch.toString('utf8')).toContain('rename to src/a.js');
      await artifact(patch);

      await expectRefused(
        commitPatch(deps(), request({ allowed: 'dist/**' })),
        /"src\/a\.js": the path matches no allowed_paths pattern/,
      );
    });

    it('refuses a workflow change by default, even when allowlisted', async () => {
      await seed({ '.github/workflows/ci.yml': 'on: push\n' });
      await write(producer, { '.github/workflows/ci.yml': 'on: pull_request_target\n' });
      await artifact(await producedPatch());

      await expectRefused(commitPatch(deps(), request({ allowed: '.github/**' })), /allow_workflow_changes is false/);
    });

    it('refuses a binary change by default', async () => {
      await seed({});
      await write(producer, { 'dist/blob.bin': Buffer.from([0, 1, 2]) });
      await artifact(await producedPatch());

      await expectRefused(commitPatch(deps(), request()), /the change is binary/);
    });

    it('refuses NUL-bearing content even when the patch presents it as text', async () => {
      await seed({});
      const patch = Buffer.concat([
        Buffer.from(
          [
            'diff --git a/x.txt b/x.txt',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/x.txt',
            '@@ -0,0 +1 @@',
            '+a',
          ].join('\n'),
        ),
        Buffer.from([0]),
        Buffer.from('b\n'),
      ]);
      await artifact(patch);

      // git may refuse the patch outright; either way nothing may be committed.
      await expectRefused(commitPatch(deps(), request()), /binary|git apply failed/);
    });

    it('refuses a new executable', async () => {
      await seed({});
      await artifact(
        [
          'diff --git a/run.sh b/run.sh',
          'new file mode 100755',
          '--- /dev/null',
          '+++ b/run.sh',
          '@@ -0,0 +1 @@',
          '+echo',
          '',
        ].join('\n'),
      );

      await expectRefused(commitPatch(deps(), request()), /new file must have mode 100644; got 100755/);
    });

    it('refuses a mode change', async () => {
      await seed({ 'run.sh': 'echo\n' });
      await artifact(['diff --git a/run.sh b/run.sh', 'old mode 100644', 'new mode 100755', ''].join('\n'));

      await expectRefused(commitPatch(deps(), request()), /alters the file mode from 100644 to 100755/);
    });

    it('refuses a change to an existing executable', async () => {
      await seed({ gradlew: 'echo 1\n' }, async (dir) => chmod(path.join(dir, 'gradlew'), 0o755));
      await write(producer, { gradlew: 'echo 2\n' });
      await artifact(await producedPatch());

      await expectRefused(commitPatch(deps(), request()), /executable bit/);
    });

    it('refuses a new symbolic link', async () => {
      await seed({ 'target.txt': 't\n' });
      await symlink('/etc/passwd', path.join(producer, 'dist-link'));
      await artifact(await producedPatch());

      await expectRefused(commitPatch(deps(), request()), /symbolic link/);
    });

    it('refuses a file written below a symbolic link of the base tree', async () => {
      await seed({ 'real/file.txt': 'r\n' }, async (dir) => symlink('real', path.join(dir, 'alias')));
      await artifact(
        [
          'diff --git a/alias/new.txt b/alias/new.txt',
          'new file mode 100644',
          '--- /dev/null',
          '+++ b/alias/new.txt',
          '@@ -0,0 +1 @@',
          '+x',
          '',
        ].join('\n'),
      );

      await expectRefused(commitPatch(deps(), request()), /symbolic link|git apply failed/);
    });
  });

  describe('a patch built to escape the repository', () => {
    it.each([
      ['an upward traversal', '../outside.txt'],
      ['a deep upward traversal', 'dist/../../outside.txt'],
      ['an absolute path', '/tmp/commit-patch-absolute.txt'],
      ['a .git path', '.git/hooks/post-checkout'],
      ['a differently cased .git path', '.GIT/config'],
      ['a nested .git path', 'sub/.git/config'],
    ])('refuses %s', async (_name, target) => {
      await seed({ 'a.txt': 'a\n' });
      await artifact(
        [
          `diff --git a/${target} b/${target}`,
          'new file mode 100644',
          '--- /dev/null',
          `+++ b/${target}`,
          '@@ -0,0 +1 @@',
          '+pwned',
          '',
        ].join('\n'),
      );

      await expectRefused(
        commitPatch(deps(), request()),
        /git apply failed|traverses upwards|absolute|\.git directory/,
      );
    });

    it('refuses a patch whose headers name one path and whose hunks name another', async () => {
      await seed({ 'dist/a.js': 'a\n', 'src/secret.ts': 's\n' });
      await artifact(
        [
          'diff --git a/dist/a.js b/dist/a.js',
          '--- a/src/secret.ts',
          '+++ b/src/secret.ts',
          '@@ -1 +1 @@',
          '-s',
          '+pwned',
          '',
        ].join('\n'),
      );

      // Whatever git makes of the contradiction, only its result is judged, and src/ is not allowed.
      await expectRefused(commitPatch(deps(), request({ allowed: 'dist/**' })), /src\/secret\.ts|git apply failed/);
    });

    it('refuses a patch that does not apply to the base', async () => {
      await seed({ 'a.txt': 'a\n' });
      await artifact(
        ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1 +1 @@', '-something else', '+b', ''].join(
          '\n',
        ),
      );

      await expectRefused(commitPatch(deps(), request()), /git apply failed/);
    });
  });

  it('fails before reading the artifact when no branch is given', async () => {
    await expect(commitPatch(deps(), request({ branch: '' }))).rejects.toThrow(/No branch given/);
  });
});
