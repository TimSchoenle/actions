import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  expectCleanRejection,
  expectNoInjection,
  oversized,
  runAction,
  ScratchRepo,
} from 'actions-e2e';
import { createOctokit } from 'actions-util/client';
import { afterAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs, Workspace, WorkspaceFiles } from 'actions-e2e';

/**
 * Hostile cases for `actions/common/commit-changes`, run against a real repository.
 *
 * This action turns a working tree into a commit on a named branch, which makes it the widest write
 * primitive in the set: `branch` decides where the commit lands and `file_pattern` decides what goes
 * into it. A pattern that reached outside the checkout would commit whatever else the runner has on
 * disk — the job's other repositories, its temp files, a token written to a config — into a public
 * repository, which is an exfiltration channel rather than a mistake.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

describe('commit-changes under hostile input', () => {
  const scratch = ScratchRepo.fromEnvironment('commit-changes-adv');
  const api = createOctokit(scratch.token);

  afterAll(() => scratch.teardown());

  function run(
    workspace: Workspace,
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'any',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { token: scratch.token, repository: scratch.repository, ...inputs },
      secrets: [scratch.token],
      workspace,
      expect: expected,
    });
  }

  async function withCheckout(
    caseName: string,
    seed: WorkspaceFiles,
    body: (context: { branch: string; workspace: Workspace; baseSha: string }) => Promise<void>,
  ): Promise<void> {
    const branch = scratch.branch(caseName);
    let baseSha = await scratch.createBranch(branch);

    for (const [filePath, contents] of Object.entries(seed)) {
      baseSha = await scratch.commitFile(branch, filePath, contents, `test: seed ${filePath}`);
    }

    const workspace = await scratch.checkout(branch);

    try {
      await body({ baseSha, branch, workspace });
    } finally {
      await workspace.dispose();
    }
  }

  /** Every path a commit touched, so a case can assert on what did *not* get in. */
  async function committedPaths(sha: string): Promise<string[]> {
    const { data } = await api.rest.repos.getCommit({ owner: scratch.owner, ref: sha, repo: scratch.repo });

    return (data.files ?? []).map((file) => file.filename).toSorted();
  }

  describe('what the file pattern may reach', () => {
    it('commits nothing from outside the working tree', async () => {
      await withCheckout('escape-pattern', { 'seed.txt': 'seed\n' }, async ({ workspace, branch, baseSha }) => {
        await workspace.write({ 'inside.txt': 'inside\n' });

        for (const pattern of ['../*', '../../*', '/etc/*', '../../../etc/hosts', 'C:/Windows/win.ini']) {
          const result = await run(workspace, { branch, commit_message: 'test: escape', file_pattern: pattern });

          expect(result.stderr, `pattern '${pattern}' crashed the action`).not.toContain('UnhandledPromiseRejection');
          expectNoInjection(result);

          const head = result.outputs['commit_hash'];

          if (head !== undefined && head !== baseSha) {
            const paths = await committedPaths(head);

            // Nothing above the checkout root, and nothing absolute, may appear in the tree.
            for (const committed of paths) {
              expect(committed, `'${pattern}' committed '${committed}'`).not.toMatch(/^([A-Za-z]:|\/|\.\.)/);
            }
          }
        }
      });
    });

    it('commits only what the pattern names, leaving its neighbours out', async () => {
      await withCheckout('narrow-pattern', {}, async ({ workspace, branch }) => {
        await workspace.write({ 'wanted/a.txt': 'a\n', 'unwanted/b.txt': 'b\n' });

        const result = await run(workspace, {
          branch,
          commit_message: 'test: narrow',
          file_pattern: 'wanted/a.txt',
        });

        expect(result.outputs['changes_detected']).toBe('true');
        await expect(committedPaths(result.outputs['commit_hash'] as string)).resolves.toEqual(['wanted/a.txt']);
      });
    });

    it('commits a path whose name only looks like an escape', async () => {
      await withCheckout('deceptive-path', {}, async ({ workspace, branch }) => {
        // `%2e%2e` and `~` are ordinary directory names to a file system, so a repository may contain
        // them and this action must be able to commit them.
        await workspace.write({ '%2e%2e/a.txt': 'a\n' });

        const result = await run(workspace, {
          branch,
          commit_message: 'test: deceptive',
          file_pattern: '%2e%2e/a.txt',
        });

        expect(result.outputs['changes_detected']).toBe('true');
        await expect(committedPaths(result.outputs['commit_hash'] as string)).resolves.toEqual(['%2e%2e/a.txt']);
      });
    });
  });

  describe('the branch it commits to', () => {
    it('fails without committing when the branch does not exist', async () => {
      await withCheckout('absent-branch', {}, async ({ workspace }) => {
        await workspace.write({ 'a.txt': 'a\n' });

        const result = await run(
          workspace,
          { branch: 'test/adv/branch-that-does-not-exist', commit_message: 'test: absent' },
          'failure',
        );

        expectCleanRejection(result);
        expect(result.outputs['commit_hash']).toBeUndefined();
      });
    });

    it.each([
      { name: 'a parent walk', value: 'test/adv/../../main' },
      { name: 'a fully qualified ref', value: 'refs/heads/main' },
      { name: 'a heads-prefixed ref', value: 'heads/main' },
      { name: 'a name git refuses', value: 'test/adv/a..b' },
    ])('refuses $name as a branch, committing nothing anywhere', async ({ value }) => {
      await withCheckout(`bad-branch-${value.replaceAll(/\W/g, '')}`, {}, async ({ workspace, branch, baseSha }) => {
        await workspace.write({ 'a.txt': 'a\n' });

        const result = await run(workspace, { branch: value, commit_message: 'test: bad branch' }, 'any');

        expect(result.outputs['commit_hash'], 'no commit may be reported').toBeUndefined();
        // The branch the case owns must be exactly where the fixture left it.
        await expect(scratch.headOf(branch, baseSha)).resolves.toBe(baseSha);
        expectNoInjection(result);
      });
    });
  });

  describe('the commit message it writes', () => {
    it('carries a message full of workflow commands without any taking effect', async () => {
      await withCheckout('hostile-message', {}, async ({ workspace, branch }) => {
        await workspace.write({ 'a.txt': 'a\n' });

        const message = commandInjectionPayload('test: hostile message');
        const result = await run(workspace, { branch, commit_message: message }, 'success');

        expectNoInjection(result);

        const { data } = await api.rest.repos.getCommit({
          owner: scratch.owner,
          ref: result.outputs['commit_hash'] as string,
          repo: scratch.repo,
        });

        // Committed as text, not interpreted — but not byte-identical either: the GraphQL commit
        // mutation takes a headline and a body as separate fields, and GitHub rejoins them with a
        // blank line. Every line survives, which is what matters; the separator is the API's.
        const [headline, ...rest] = message.split('\n');

        expect(data.commit.message).toBe(`${headline}\n\n${rest.join('\n')}`);
      });
    });

    it('refuses an empty commit message rather than writing one', async () => {
      await withCheckout('empty-message', {}, async ({ workspace, branch, baseSha }) => {
        await workspace.write({ 'a.txt': 'a\n' });

        const result = await run(workspace, { branch, commit_message: '' }, 'failure');

        expectCleanRejection(result);
        await expect(scratch.headOf(branch, baseSha)).resolves.toBe(baseSha);
      });
    });

    it('carries a message far longer than a person would write', async () => {
      await withCheckout('huge-message', {}, async ({ workspace, branch }) => {
        await workspace.write({ 'a.txt': 'a\n' });

        const result = await run(workspace, { branch, commit_message: `test: ${oversized(20_000)}` }, 'any');

        expect(result.stderr).not.toContain('UnhandledPromiseRejection');
        expectNoInjection(result);
      });
    });
  });

  describe('injection through the inputs', () => {
    it('never echoes the token, whatever it is asked to commit', async () => {
      await withCheckout('token-leak', {}, async ({ workspace, branch }) => {
        await workspace.write({ 'a.txt': 'a\n' });

        const result = await run(workspace, {
          branch,
          commit_message: commandInjectionPayload('test: leak'),
          file_pattern: commandInjectionPayload('a.txt'),
        });

        expect(result.stdout).not.toContain(scratch.token);
        expect(result.stderr).not.toContain(scratch.token);
        expectNoInjection(result);
      });
    });

    it.each([
      { name: 'no slash', value: 'justaname' },
      { name: 'too many segments', value: 'owner/repo/extra' },
      { name: 'a parent walk', value: 'owner/../other' },
    ])('refuses a repository slug with $name', async ({ value }) => {
      await withCheckout(`bad-repo-${value.replaceAll(/\W/g, '')}`, {}, async ({ workspace, branch }) => {
        await workspace.write({ 'a.txt': 'a\n' });

        const result = await run(workspace, { repository: value, branch, commit_message: 'test: bad repo' }, 'failure');

        expect(result.outputs['commit_hash']).toBeUndefined();
        expectNoInjection(result);
      });
    });
  });
});
