import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stageBundles } from 'action-graph';
import { runAction, ScratchRepo } from 'actions-e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../helper/src/generated/action-io.js';
import type { StagedBundles } from 'action-graph';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/release/publish-build-commit` against the scratch repository.
 *
 * The helper runs in publish mode over a directory staged the way build-actions stages one, as
 * download-artifact would leave it. Every ref the cases create lives in the suite's `test/` namespace:
 * the source commit and the releases branch are scratch branches, the consumer and source tags are
 * scratch tags, and teardown deletes the releases on those tags with them.
 *
 * A non-fast-forward race on the releases branch cannot be provoked deterministically here; the unit
 * cases cover the retry against a real git repository.
 */

const HELPER_DIRECTORY = fileURLToPath(new URL('../helper', import.meta.url));
const BUNDLE = 'actions/demo/dist/index.js';

const scratch = ScratchRepo.fromEnvironment('publish-build-commit');

afterAll(() => scratch.teardown());

describe('publish-build-commit', () => {
  let temp: string;
  let source: string;

  beforeAll(async () => {
    temp = await mkdtemp(path.join(tmpdir(), 'publish-build-commit-e2e-'));
    const branch = scratch.branch('source');
    await scratch.createBranch(branch);
    source = await scratch.commitFile(
      branch,
      'actions/demo/action.yml',
      "runs:\n  using: 'node24'\n  main: 'dist/index.js'\n",
      'test: demo action',
    );
  });

  afterAll(async () => {
    await rm(temp, { force: true, recursive: true });
  });

  /** Stages the demo bundle for `source` in a fresh directory under the runner temp directory. */
  async function stage(content = 'console.log("built");\n'): Promise<StagedBundles> {
    const build = await mkdtemp(path.join(temp, 'build-'));
    await mkdir(path.join(build, 'actions/demo/dist'), { recursive: true });
    await writeFile(path.join(build, BUNDLE), content);

    return stageBundles(build, ['actions/demo'], [BUNDLE], await mkdtemp(path.join(temp, 'download-')), {
      sourceSha: source,
      toolchain: 'e2e',
      generatedBy: 'e2e',
    });
  }

  /** The releases input for one release with a source tag. */
  async function releases(consumerTag: string, sourceTag: string): Promise<string> {
    const notesFile = path.join(temp, `${consumerTag.replaceAll('/', '_')}.md`);
    await writeFile(notesFile, `* released by the e2e suite\n`);

    return JSON.stringify([{ consumerTag, sourceTag, releaseName: 'demo: v1.0.0', notesFile, path: 'actions/demo' }]);
  }

  function publish(
    staged: StagedBundles,
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: HELPER_DIRECTORY,
      env: { RUNNER_TEMP: temp },
      expect: expected,
      inputs: {
        mode: 'publish',
        token: scratch.token,
        repository: scratch.repository,
        source_sha: source,
        artifact_id: '1',
        expected_manifest_sha256: staged.manifestSha256,
        allowed_paths: 'actions/**/dist/**',
        existing_files: 'fail',
        release_assets: 'checksums',
        make_latest: 'false',
        directory: staged.directory,
        run_url: 'https://github.com/TimSchoenle/actions/actions/runs/1/attempts/1',
        ...inputs,
      },
      secrets: [scratch.token],
      timeoutMs: 170_000,
    });
  }

  it('publishes, is a no-op on a second run, and writes nothing in a dry run first', async () => {
    const staged = await stage();
    const consumerTag = scratch.tag('demo-v1.0.0');
    const sourceTag = scratch.tag('src-demo-v1.0.0');
    const releasesBranch = scratch.branch('releases');
    const inputs = { releases: await releases(consumerTag, sourceTag), releases_branch: releasesBranch };

    const dry = await publish(staged, { ...inputs, dry_run: 'true' });
    expect(dry.outputs).toMatchObject({ build_sha: '', created: '[]' });
    expect(await scratch.refSha(releasesBranch)).toBeUndefined();
    expect(await scratch.tagSha(consumerTag)).toBeUndefined();

    const first = await publish(staged, inputs);
    const build = first.outputs.build_sha ?? '';
    expect(first.outputs.tree_sha).toBe(dry.outputs.tree_sha);
    expect(await scratch.commit(build)).toEqual({ tree: dry.outputs.tree_sha, parents: [source] });
    expect(await scratch.changedFiles(source, build)).toEqual([`added ${BUNDLE}`]);
    expect(await scratch.headOf(releasesBranch, build)).toBe(build);
    expect(await scratch.tagSha(consumerTag)).toBe(build);
    expect(await scratch.tagSha(sourceTag)).toBe(source);
    expect(await scratch.releasesForTag(consumerTag)).toEqual([
      expect.objectContaining({ draft: false, name: 'demo: v1.0.0', assets: ['bundles.sha256'] }),
    ]);

    const second = await publish(staged, inputs);
    expect(second.outputs.created).toBe('[]');
    expect(second.outputs.build_sha).toBe(build);
  });

  it('fails on a consumer tag created at another commit, before any write', async () => {
    const staged = await stage('console.log("second");\n');
    const consumerTag = scratch.tag('blocked-v1.0.0');
    const sourceTag = scratch.tag('src-blocked-v1.0.0');
    const releasesBranch = scratch.branch('blocked-releases');
    const inputs = { releases: await releases(consumerTag, sourceTag), releases_branch: releasesBranch };
    await scratch.createTag(consumerTag, source);

    const refused = await publish(staged, inputs, 'failure');
    expect(refused.errors.join('\n')).toMatch(
      new RegExp(`Tag ${consumerTag.replaceAll('/', '\\/')} exists at ${source}`),
    );
    expect(await scratch.releasesForTag(consumerTag)).toEqual([]);

    // The blocker was the consumer tag itself, which is checked before any write, so nothing moved.
    expect(await scratch.refSha(releasesBranch)).toBeUndefined();
  });

  it('resumes an interrupted run: reuses its build commit and completes the draft it left', async () => {
    const staged = await stage('console.log("third");\n');
    const consumerTag = scratch.tag('resumed-v1.0.0');
    const sourceTag = scratch.tag('src-resumed-v1.0.0');
    const releasesBranch = scratch.branch('resumed-releases');
    const inputs = { releases: await releases(consumerTag, sourceTag), releases_branch: releasesBranch };

    // A source tag at the wrong commit stops the first run after the build commit and the branch.
    await scratch.createTag(sourceTag, (await scratch.commit(source)).parents[0] ?? source);
    const interrupted = await publish(staged, inputs, 'failure');
    expect(interrupted.errors.join('\n')).toMatch(/exists at .*, expected/);
    const head = await scratch.refSha(releasesBranch);
    expect(head).toBeDefined();
    expect(await scratch.tagSha(consumerTag)).toBe(head);
    await scratch.createDraftRelease(consumerTag, 'left by an interrupted run');
    // Removing the wrong source tag is what an operator does before re-running failed jobs.
    await scratch.deleteTag(sourceTag);

    const resumed = await publish(staged, inputs);

    expect(resumed.outputs.build_sha).toBe(head);
    expect(JSON.parse(resumed.outputs.created ?? '[]')).not.toContainEqual(expect.stringMatching(/^commit:/));
    expect(await scratch.releasesForTag(consumerTag)).toEqual([
      expect.objectContaining({ draft: false, name: 'demo: v1.0.0', assets: ['bundles.sha256'] }),
    ]);
  });

  it('refuses bundles built from another commit before any write', async () => {
    const staged = await stage();
    const consumerTag = scratch.tag('foreign-v1.0.0');

    const result = await publish(
      staged,
      { releases: await releases(consumerTag, scratch.tag('src-foreign-v1.0.0')), source_sha: '0'.repeat(40) },
      'failure',
    );

    expect(result.errors.join('\n')).toMatch(/not from source-sha 0{40}/);
    expect(await scratch.tagSha(consumerTag)).toBeUndefined();
  });
});
