import { chmod, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAction, ScratchRepo } from 'actions-e2e';
import { resolveOptional } from 'actions-util';
import { createOctokit } from 'actions-util/client';
import { afterAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs, Workspace, WorkspaceFiles } from 'actions-e2e';

/**
 * End-to-end cases for `actions/common/commit-changes`, run against a real repository.
 *
 * These replace all eight verify jobs of `verify-action-common-commit-changes.yaml`:
 * `test-commit-file-patterns`, `test-pattern-excludes-unrelated`, `test-modify-existing-file`,
 * `test-file-deletion`, `test-no-commit-scenarios`, `test-custom-branch`, `test-commit-message` and
 * `test-commit-verified`.
 *
 * Five things are asserted here that the shell version could not:
 *
 * - the *entire* output set of every run, so an output that appears or disappears fails a case, where
 *   the per-field `[ -z "$X" ]` checks could notice neither;
 * - the committed bytes, read back from the remote and compared against the working tree the action
 *   was pointed at — the shell version compared file *names* only;
 * - that a branch the run did not name stays exactly where it was, which is the actual claim behind
 *   "commits to the branch you give it";
 * - a multi-line commit message surviving the headline/body split the GraphQL commit API imposes;
 * - the error path for a missing branch, which needs `continue-on-error` plus a second step to
 *   inspect in a workflow, and so was never asserted there.
 *
 * Fixtures are built through the REST API rather than by running the action first, as the workflow's
 * modify, delete and chmod jobs did: a fixture produced by the code under test cannot distinguish a
 * correct result from two matching bugs.
 *
 * The `empty` input the workflow passes to its no-commit jobs is not ported — `action.yaml` never
 * declared it, so the runner discarded it and there is no allowed-empty behaviour to assert.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

/** Turns a case title into the ref-safe segment its branch is named after. */
function caseSlug(name: string): string {
  return name.replaceAll(' ', '-');
}

/** One entry of a commit's file list, as the REST commit endpoint reports it. */
interface CommittedChange {
  path: string;
  status: string;
}

/** The parts of a commit the cases assert on, read back from the remote. */
interface RemoteCommit {
  message: string;
  verified: boolean;
  /** GitHub's verdict on the signature; `valid` is the only accepted one. */
  verificationReason: string;
  /** Every path the commit touched, ordered by path so the assertion never depends on API order. */
  changes: CommittedChange[];
}

/** What a case gets after its branch exists and has been cloned into a working tree. */
interface CaseContext {
  branch: string;
  workspace: Workspace;
  /** The commit the branch pointed at when it was cloned, which a no-commit case must still see. */
  baseSha: string;
}

describe('commit-changes', () => {
  const scratch = ScratchRepo.fromEnvironment('commit-changes');
  // The suite reads commit contents, messages and signatures, none of which `ScratchRepo` exposes.
  const api = createOctokit(scratch.token);

  afterAll(() => scratch.teardown());

  function run(
    workspace: Workspace,
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { token: scratch.token, repository: scratch.repository, ...inputs },
      secrets: [scratch.token],
      workspace,
      expect: expected,
    });
  }

  /**
   * Reserves the case's branch, seeds it through the API, clones it and disposes of the clone.
   *
   * The branch is reserved before anything is created, so teardown removes it even when the case
   * fails halfway through; the working tree is this suite's to own, so it is removed here.
   *
   * @param seed files to commit to the branch before it is cloned, one commit each.
   */
  async function withCheckout(
    caseName: string,
    seed: WorkspaceFiles,
    body: (context: CaseContext) => Promise<void>,
  ): Promise<void> {
    const branch = scratch.branch(caseName);
    let baseSha = await scratch.createBranch(branch);

    for (const [filePath, contents] of Object.entries(seed)) {
      baseSha = await scratch.commitFile(branch, filePath, contents, `test: seed ${filePath} for ${caseName}`);
    }

    const workspace = await scratch.checkout(branch);

    try {
      await body({ baseSha, branch, workspace });
    } finally {
      await workspace.dispose();
    }
  }

  /** Reads back everything the cases assert about a commit, in one request. */
  async function remoteCommit(sha: string): Promise<RemoteCommit> {
    const { data } = await api.rest.repos.getCommit({ owner: scratch.owner, ref: sha, repo: scratch.repo });
    const changes = (data.files ?? []).map((file) => ({ path: file.filename, status: file.status }));

    return {
      changes: changes.sort((left, right) => (left.path < right.path ? -1 : 1)),
      message: data.commit.message,
      verified: data.commit.verification?.verified ?? false,
      // A commit whose response carries no verification block at all is a failure, not an absence, so
      // it gets a reason no assertion accepts rather than being reported as unsigned.
      verificationReason: data.commit.verification?.reason ?? 'no verification reported',
    };
  }

  /** The content of a file at a ref, or `undefined` when the ref has no such file. */
  async function remoteFile(filePath: string, ref: string): Promise<string | undefined> {
    const response = await resolveOptional(
      api.rest.repos.getContent({ owner: scratch.owner, path: filePath, ref, repo: scratch.repo }),
    );
    const data = response?.data;

    if (data === undefined || Array.isArray(data) || data.type !== 'file') {
      return undefined;
    }

    return Buffer.from(data.content, 'base64').toString('utf8');
  }

  /**
   * Asserts a run committed, and returns the commit it created.
   *
   * `commit_hash` is fed back into the expected object on purpose: what this pins is the output *set*
   * and the URL the action derives from the hash. The hash itself is then held to the shape of a SHA
   * and, more to the point, to being what the branch actually points at on the remote.
   */
  async function expectCommitted(result: ActionRunResult<ActionOutput>, branch: string): Promise<string> {
    const sha = result.outputs.commit_hash ?? '';

    expect(result.outputs).toEqual({
      changes_detected: 'true',
      commit_hash: sha,
      commit_url: `https://github.com/${scratch.repository}/commit/${sha}`,
    });
    expect(sha).toMatch(/^[\da-f]{40}$/);
    await expect(scratch.headOf(branch, sha)).resolves.toBe(sha);

    return sha;
  }

  /** Asserts a run committed nothing, and that the branch is still where the case left it. */
  async function expectNoCommit(
    result: ActionRunResult<ActionOutput>,
    { baseSha, branch }: CaseContext,
  ): Promise<void> {
    expect(result.outputs).toEqual({ changes_detected: 'false' });
    await expect(scratch.headOf(branch, baseSha)).resolves.toBe(baseSha);
  }

  /**
   * Asserts a commit touched exactly the given paths, each carrying the working tree's bytes.
   *
   * Comparing the remote content against the working tree rather than against a literal is what makes
   * this a round-trip assertion: the action base64-encodes what it read from disk, and a truncated or
   * re-encoded upload can only show up against the file it came from.
   */
  async function expectCommittedFiles(sha: string, workspace: Workspace, paths: readonly string[]): Promise<void> {
    const commit = await remoteCommit(sha);

    expect(commit.changes).toEqual(paths.map((path) => ({ path, status: 'added' })));

    for (const path of paths) {
      await expect(remoteFile(path, sha), path).resolves.toBe(await workspace.read(path));
    }
  }

  interface PatternCase {
    name: string;
    filePattern: string;
    /** Fixture files written into the working tree before the run. */
    files: WorkspaceFiles;
    /** The paths the commit must contain, in path order, and nothing else. */
    committed: readonly string[];
  }

  const patternCases: readonly PatternCase[] = [
    {
      name: 'a single explicit file',
      filePattern: 'test-output/single.txt',
      files: { 'test-output/single.txt': 'single\n' },
      committed: ['test-output/single.txt'],
    },
    {
      name: 'several explicit files',
      filePattern: 'test-output/a.txt test-output/b.md',
      files: { 'test-output/a.txt': 'a\n', 'test-output/b.md': '# b\n' },
      committed: ['test-output/a.txt', 'test-output/b.md'],
    },
    {
      name: 'a single glob',
      filePattern: 'test-output/*.txt',
      files: { 'test-output/glob-match.txt': 'glob\n' },
      committed: ['test-output/glob-match.txt'],
    },
    {
      name: 'a glob spanning directory levels',
      filePattern: 'actions/**/dist/**/*',
      files: { 'actions/foo/dist/deep.js': 'export const deep = true;\n' },
      committed: ['actions/foo/dist/deep.js'],
    },
    {
      name: 'several globs spanning directory levels',
      filePattern: 'actions/**/dist/**/* workflows/**/dist/**/*',
      files: { 'actions/foo/dist/a.txt': 'a\n', 'workflows/bar/dist/b.txt': 'b\n' },
      committed: ['actions/foo/dist/a.txt', 'workflows/bar/dist/b.txt'],
    },
    {
      name: 'the whole tree',
      filePattern: '.',
      files: { 'dot-all-test.txt': 'dot all\n' },
      committed: ['dot-all-test.txt'],
    },
    {
      name: 'a nested untracked directory',
      filePattern: '.',
      files: { 'new-dir/sub/nested.txt': 'nested\n' },
      committed: ['new-dir/sub/nested.txt'],
    },
  ];

  it.each(patternCases)('commits $name', async (testCase) => {
    await withCheckout(caseSlug(testCase.name), {}, async ({ branch, workspace }) => {
      await workspace.write(testCase.files);

      const result = await run(workspace, {
        branch,
        commit_message: `test: commit ${testCase.name}`,
        file_pattern: testCase.filePattern,
      });

      const sha = await expectCommitted(result, branch);
      await expectCommittedFiles(sha, workspace, testCase.committed);
    });
  });

  interface ExclusionCase extends PatternCase {
    /** Files the working tree also holds, which the pattern must leave out of the commit. */
    excluded: readonly string[];
  }

  const exclusionCases: readonly ExclusionCase[] = [
    {
      name: 'an explicit path leaves a sibling directory alone',
      filePattern: 'include/target.txt',
      files: { 'include/target.txt': 'target\n', 'exclude/noise.txt': 'noise\n' },
      committed: ['include/target.txt'],
      excluded: ['exclude/noise.txt'],
    },
    {
      name: 'a glob does not escape into a sibling directory',
      filePattern: 'src/**/*.ts',
      files: { 'src/core/index.ts': 'export const core = 1;\n', 'docs/readme.md': '# docs\n' },
      committed: ['src/core/index.ts'],
      excluded: ['docs/readme.md'],
    },
    {
      name: 'a path inside a directory does not drag in its parent',
      filePattern: 'inside/file.txt',
      files: { 'inside/file.txt': 'inside\n', 'outside.txt': 'outside\n' },
      committed: ['inside/file.txt'],
      excluded: ['outside.txt'],
    },
  ];

  it.each(exclusionCases)('commits only what the pattern selects: $name', async (testCase) => {
    await withCheckout(caseSlug(testCase.name), {}, async ({ branch, workspace }) => {
      await workspace.write(testCase.files);

      const result = await run(workspace, {
        branch,
        commit_message: `test: exclusion ${testCase.name}`,
        file_pattern: testCase.filePattern,
      });

      const sha = await expectCommitted(result, branch);
      await expectCommittedFiles(sha, workspace, testCase.committed);

      // The commit's file list already excludes these; asserting the branch too rules out the file
      // having arrived through some earlier commit the action left behind.
      for (const path of testCase.excluded) {
        await expect(remoteFile(path, branch), path).resolves.toBeUndefined();
      }
    });
  });

  it('commits a change to a file the branch already tracks', async () => {
    await withCheckout('modify-existing', { 'test-modify/data.txt': 'version 1\n' }, async ({ branch, workspace }) => {
      await workspace.write({ 'test-modify/data.txt': 'version 2\n' });

      const result = await run(workspace, {
        branch,
        commit_message: 'test: modify an existing file',
        file_pattern: 'test-modify/data.txt',
      });

      const sha = await expectCommitted(result, branch);

      await expect(remoteCommit(sha)).resolves.toMatchObject({
        changes: [{ path: 'test-modify/data.txt', status: 'modified' }],
      });
      await expect(remoteFile('test-modify/data.txt', branch)).resolves.toBe('version 2\n');
    });
  });

  it('commits the removal of a file the branch tracks', async () => {
    await withCheckout('delete-tracked', { 'test-delete/doomed.txt': 'doomed\n' }, async ({ branch, workspace }) => {
      // Removed without staging, exactly as the workflow's `rm` did: the action classifies from the
      // working tree, so an unstaged deletion has to be recognised as one.
      await rm(join(workspace.path, 'test-delete', 'doomed.txt'));

      const result = await run(workspace, {
        branch,
        commit_message: 'test: delete a tracked file',
        file_pattern: 'test-delete/doomed.txt',
      });

      const sha = await expectCommitted(result, branch);

      await expect(remoteCommit(sha)).resolves.toMatchObject({
        changes: [{ path: 'test-delete/doomed.txt', status: 'removed' }],
      });
      await expect(remoteFile('test-delete/doomed.txt', branch)).resolves.toBeUndefined();
    });
  });

  interface NoCommitCase {
    name: string;
    filePattern: string;
    /** Prepares a working tree the action must find nothing committable in. */
    prepare?: (workspace: Workspace) => Promise<void>;
  }

  const noCommitCases: readonly NoCommitCase[] = [
    { name: 'a clean working tree', filePattern: '.' },
    {
      name: 'an empty directory',
      filePattern: '.',
      prepare: async (workspace) => {
        // git tracks files, not directories, so this must not register as a change at all.
        await mkdir(join(workspace.path, 'empty-dir', 'subdir'), { recursive: true });
      },
    },
    {
      name: 'a change no pattern matches',
      filePattern: 'does-not-exist/**/*.txt',
      prepare: (workspace) => workspace.write({ 'mismatch/outside.txt': 'noise\n' }),
    },
    {
      name: 'a file git is told to ignore',
      filePattern: '.',
      // Through `.git/info/exclude` rather than `.gitignore`, which would itself be a committable
      // change and so could not tell the two apart.
      prepare: (workspace) =>
        workspace.write({ '.git/info/exclude': 'ignored/secret.txt\n', 'ignored/secret.txt': 'SECRET\n' }),
    },
  ];

  it.each(noCommitCases)('creates no commit for $name', async (testCase) => {
    await withCheckout(caseSlug(testCase.name), {}, async (context) => {
      await testCase.prepare?.(context.workspace);

      const result = await run(context.workspace, {
        branch: context.branch,
        commit_message: `test: no commit for ${testCase.name}`,
        file_pattern: testCase.filePattern,
      });

      await expectNoCommit(result, context);
    });
  });

  it('creates no commit for a permission-only change', async () => {
    await withCheckout('chmod-only', { 'test-chmod/script.sh': 'echo hello\n' }, async (context) => {
      await chmod(join(context.workspace.path, 'test-chmod', 'script.sh'), 0o755);

      const result = await run(context.workspace, {
        branch: context.branch,
        commit_message: 'test: permission-only change',
        file_pattern: '.',
      });

      await expectNoCommit(result, context);
      // The mechanism, not just the outcome: git only stays quiet about the mode because the action
      // turned mode tracking off first. On Windows git never tracks it, so the config is the only
      // part of this case that means anything there.
      await expect(context.workspace.gitConfig('core.fileMode')).resolves.toBe('false');
    });
  });

  it('commits to the branch it is given and moves no other', async () => {
    const bystander = scratch.branch('bystander');
    const bystanderSha = await scratch.createBranch(bystander);

    await withCheckout('custom-branch', {}, async ({ branch, workspace }) => {
      await workspace.write({ 'test-branch/file.txt': 'branch test\n' });

      const result = await run(workspace, {
        branch,
        commit_message: 'test: commit to a named branch',
        file_pattern: 'test-branch/file.txt',
      });

      const sha = await expectCommitted(result, branch);

      expect(sha).not.toBe(bystanderSha);
      await expect(scratch.headOf(bystander, bystanderSha)).resolves.toBe(bystanderSha);
    });
  });

  const messageCases = [
    { name: 'a single-line message', message: 'chore(test): verify the commit message' },
    // The GraphQL commit API takes a headline and a body separately, so a multi-line message only
    // survives if the action splits it and GitHub rejoins it exactly.
    { name: 'a multi-line message', message: 'chore(test): headline\n\nbody line one\nbody line two' },
  ] as const;

  it.each(messageCases)('commits with $name', async (testCase) => {
    await withCheckout(caseSlug(testCase.name), {}, async ({ branch, workspace }) => {
      await workspace.write({ 'message-test.txt': 'message test\n' });

      const result = await run(workspace, {
        branch,
        commit_message: testCase.message,
        file_pattern: 'message-test.txt',
      });

      const sha = await expectCommitted(result, branch);

      await expect(remoteCommit(sha)).resolves.toMatchObject({ message: testCase.message });
    });
  });

  // The commit goes through `createCommitOnBranch`, so GitHub authors it and signs it with its own
  // key. Any reason other than `valid` means the action stopped producing verified commits — the one
  // property the whole GraphQL approach exists for.
  it('creates a commit GitHub reports as verified', async () => {
    await withCheckout('verified', {}, async ({ branch, workspace }) => {
      await workspace.write({ 'verified-test.txt': 'verified test\n' });

      const result = await run(workspace, {
        branch,
        commit_message: 'test: verified commit',
        file_pattern: 'verified-test.txt',
      });

      const sha = await expectCommitted(result, branch);

      await expect(remoteCommit(sha)).resolves.toMatchObject({ verified: true, verificationReason: 'valid' });
    });
  });

  // Not portable to the shell version: asserting on a *failed* step there needs `continue-on-error`
  // plus a second step to inspect the outcome, which is why no verify job asserts an error path.
  it('fails without committing when no branch is given', async () => {
    await withCheckout('missing-branch', {}, async (context) => {
      await context.workspace.write({ 'never-committed.txt': 'never\n' });

      const result = await run(
        context.workspace,
        { branch: '', commit_message: 'test: no branch', file_pattern: '.' },
        'failure',
      );

      expect(result.errors).toEqual(['No branch given. A branch to commit to is required.']);
      expect(result.outputs).toEqual({});
      await expect(scratch.headOf(context.branch, context.baseSha)).resolves.toBe(context.baseSha);
    });
  });
});
