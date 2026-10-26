import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAction, ScratchRepo } from 'actions-e2e';
import { resolveOptional } from 'actions-util';
import { createOctokit } from 'actions-util/client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../helper/src/generated/action-io.js';
import type {
  ActionInput as CreateInput,
  ActionOutput as CreateOutput,
} from '../../create-patch/helper/src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs, Workspace, WorkspaceFiles } from 'actions-e2e';

/**
 * End-to-end cases for `actions/common/commit-patch`, run against a real repository.
 *
 * Each case builds the patch the way the workflow does: the shipped `create-patch` helper runs over a
 * checkout the case has changed, and its artifact directory is handed to this action's helper in
 * commit mode. download-artifact, which sits between the two in a workflow, only moves the directory.
 *
 * What only a real repository can show is asserted here: the commit is verified, it holds the bytes
 * the patch described and nothing else, it lands on the branch the case named with the base as its
 * parent, and a refused or stale patch leaves the branch exactly where it was.
 */

const HELPER_DIRECTORY = fileURLToPath(new URL('../helper', import.meta.url));
const CREATE_PATCH_HELPER_DIRECTORY = fileURLToPath(new URL('../../create-patch/helper', import.meta.url));

/** Turns a case title into the ref-safe segment its branch is named after. */
function caseSlug(name: string): string {
  return name.replaceAll(' ', '-');
}

interface CaseContext {
  branch: string;
  workspace: Workspace;
  baseSha: string;
}

describe('commit-patch', () => {
  const scratch = ScratchRepo.fromEnvironment('commit-patch');
  const api = createOctokit(scratch.token);
  let temp: string;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(tmpdir(), 'commit-patch-e2e-'));
  });

  afterEach(async () => {
    await rm(temp, { force: true, recursive: true });
  });

  afterAll(() => scratch.teardown());

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

  /** Runs the create-patch helper over the checkout, and returns the artifact directory it wrote. */
  async function createPatch(workspace: Workspace, paths = '.'): Promise<string> {
    const result = await runAction<CreateInput, CreateOutput>({
      actionDirectory: CREATE_PATCH_HELPER_DIRECTORY,
      env: { RUNNER_TEMP: temp },
      inputs: { artifact_name: 'e2e-patch', paths },
      workspace,
    });

    return result.outputs.directory ?? '';
  }

  function commit(
    workspace: Workspace,
    context: Pick<CaseContext, 'baseSha' | 'branch'>,
    directory: string,
    inputs: ProvidedInputs<ActionInput> = {},
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: HELPER_DIRECTORY,
      env: { RUNNER_TEMP: temp },
      expect: expected,
      inputs: {
        allowed_paths: 'generated/**',
        artifact_name: 'e2e-patch',
        branch: context.branch,
        commit_message: 'test: commit the patch',
        directory,
        expected_head_sha: context.baseSha,
        mode: 'commit',
        repository: scratch.repository,
        token: scratch.token,
        ...inputs,
      },
      secrets: [scratch.token],
      workspace,
    });
  }

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

  it('commits the patch as a verified commit on top of the base', async () => {
    await withCheckout('commits', { 'generated/old.txt': 'old\n', 'generated/gone.txt': 'bye\n' }, async (context) => {
      const { baseSha, branch, workspace } = context;
      await workspace.write({
        'generated/old.txt': 'new\n',
        'generated/deep/added.txt': 'added\n',
        'outside.txt': 'not in paths\n',
      });
      await workspace.git(['rm', '--quiet', 'generated/gone.txt']);

      const result = await commit(workspace, context, await createPatch(workspace, 'generated/**'));
      const sha = result.outputs.commit_sha ?? '';

      expect(result.outputs).toEqual({
        changes_committed: 'true',
        commit_sha: sha,
        commit_url: `https://github.com/${scratch.repository}/commit/${sha}`,
        outcome: 'committed',
      });
      await expect(scratch.headOf(branch, sha)).resolves.toBe(sha);

      const { data } = await api.rest.repos.getCommit({ owner: scratch.owner, ref: sha, repo: scratch.repo });
      expect(data.commit.verification?.verified).toBe(true);
      expect(data.parents.map((parent) => parent.sha)).toEqual([baseSha]);
      expect((data.files ?? []).map((file) => `${file.status} ${file.filename}`).sort()).toEqual([
        'added generated/deep/added.txt',
        'modified generated/old.txt',
        'removed generated/gone.txt',
      ]);
      await expect(remoteFile('generated/old.txt', sha)).resolves.toBe('new\n');
      await expect(remoteFile('generated/deep/added.txt', sha)).resolves.toBe('added\n');
    });
  });

  it('commits a unicode path and a hostile multi-line message exactly as given', async () => {
    // Shell metacharacters in both, and a path git quotes in the patch: none may be interpreted,
    // re-encoded or dropped on the way through create-patch, the policy and createCommitOnBranch.
    const filePath = 'generated/ünïcödé 文件 $(id) `uname`;.txt';
    const message = [
      'test: commit $(id) `uname` ${HOME} "quoted" \'single\'',
      '',
      'line one; rm -rf / && echo pwned | tee /tmp/x',
      'line two <!-- --> \\n %0A ::error::not a workflow command',
    ].join('\n');

    await withCheckout(caseSlug('hostile input'), {}, async (context) => {
      await context.workspace.write({ [filePath]: 'ünïcödé\n' });

      const result = await commit(context.workspace, context, await createPatch(context.workspace), {
        commit_message: message,
      });
      const sha = result.outputs.commit_sha ?? '';

      expect(result.outputs.outcome).toBe('committed');
      await expect(scratch.headOf(context.branch, sha)).resolves.toBe(sha);

      const { data } = await api.rest.repos.getCommit({ owner: scratch.owner, ref: sha, repo: scratch.repo });
      expect(data.commit.message).toBe(message);
      expect(data.commit.verification?.verified).toBe(true);
      expect((data.files ?? []).map((file) => `${file.status} ${file.filename}`)).toEqual([`added ${filePath}`]);
      await expect(remoteFile(filePath, sha)).resolves.toBe('ünïcödé\n');
    });
  });

  it('reports no_changes for an empty patch and leaves the branch alone', async () => {
    await withCheckout(caseSlug('no changes'), {}, async (context) => {
      const result = await commit(context.workspace, context, await createPatch(context.workspace));

      expect(result.outputs).toEqual({
        changes_committed: 'false',
        commit_sha: '',
        commit_url: '',
        outcome: 'no_changes',
      });
      await expect(scratch.headOf(context.branch, context.baseSha)).resolves.toBe(context.baseSha);
    });
  });

  it('skips with a notice when the branch moved after the patch was made', async () => {
    await withCheckout(caseSlug('branch moved'), {}, async (context) => {
      await context.workspace.write({ 'generated/file.txt': 'patched\n' });
      const directory = await createPatch(context.workspace);
      const moved = await scratch.commitFile(
        context.branch,
        'concurrent.txt',
        'pushed meanwhile\n',
        'test: move the branch',
      );

      const result = await commit(context.workspace, context, directory);

      expect(result.outputs).toEqual({
        changes_committed: 'false',
        commit_sha: '',
        commit_url: '',
        outcome: 'branch_moved',
      });
      expect(result.notices.join('\n')).toContain(`no longer at ${context.baseSha}`);
      await expect(scratch.headOf(context.branch, moved)).resolves.toBe(moved);
    });
  });

  it('refuses a patch touching a path outside allowed_paths, and commits nothing', async () => {
    await withCheckout(caseSlug('outside allowlist'), {}, async (context) => {
      await context.workspace.write({ 'generated/ok.txt': 'ok\n', 'src/evil.ts': 'export {};\n' });

      const result = await commit(context.workspace, context, await createPatch(context.workspace), {}, 'failure');

      expect(result.errors.join('\n')).toContain('"src/evil.ts": the path matches no allowed_paths pattern');
      expect(result.outputs).toEqual({});
      await expect(scratch.headOf(context.branch, context.baseSha)).resolves.toBe(context.baseSha);
    });
  });

  it('refuses a workflow change unless allow_workflow_changes is true', async () => {
    await withCheckout(caseSlug('workflow change'), {}, async (context) => {
      await context.workspace.write({ '.github/workflows/injected.yml': 'on: push\n' });

      const result = await commit(
        context.workspace,
        context,
        await createPatch(context.workspace),
        { allowed_paths: '.github/**' },
        'failure',
      );

      expect(result.errors.join('\n')).toContain('allow_workflow_changes is false');
      await expect(scratch.headOf(context.branch, context.baseSha)).resolves.toBe(context.baseSha);
    });
  });
});
