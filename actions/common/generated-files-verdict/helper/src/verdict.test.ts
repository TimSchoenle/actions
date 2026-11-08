import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describePatch, runGit, runGitText, serializeMetadata } from 'actions-util/patch';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyPatches,
  downloadPattern,
  evaluateNeeds,
  inspectPatches,
  MixedBaseError,
  NeedsInputError,
  parseNeeds,
  PatchConflictError,
} from './verdict.js';

const BASE = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

describe('parseNeeds', () => {
  it('reads the shape toJSON(needs) produces', () => {
    const jobs = parseNeeds(
      JSON.stringify({
        docs: { outputs: { artifact_name: 'docs', has_changes: 'true' }, result: 'success' },
        format: { outputs: {}, result: 'skipped' },
      }),
    );

    expect(jobs).toEqual([
      { id: 'docs', outputs: { artifact_name: 'docs', has_changes: 'true' }, result: 'success' },
      { id: 'format', outputs: {}, result: 'skipped' },
    ]);
  });

  it('treats a job without outputs as having none', () => {
    expect(parseNeeds('{"lint":{"result":"success"}}')).toEqual([{ id: 'lint', outputs: {}, result: 'success' }]);
  });

  it.each([
    ['not JSON', 'needs.docs'],
    ['an array', '[]'],
    ['an empty object', '{}'],
    ['a job that is not an object', '{"docs":"success"}'],
    ['an unknown result', '{"docs":{"result":"neutral"}}'],
    ['a missing result', '{"docs":{"outputs":{}}}'],
    ['outputs that are not strings', '{"docs":{"result":"success","outputs":{"has_changes":true}}}'],
  ])('refuses %s', (_label, text) => {
    expect(() => parseNeeds(text)).toThrow(NeedsInputError);
  });
});

describe('evaluateNeeds', () => {
  const job = (id: string, result: 'success' | 'failure' | 'cancelled' | 'skipped', outputs = {}) => ({
    id,
    outputs,
    result,
  });

  it('passes when nothing failed and nothing is pending', () => {
    const evaluation = evaluateNeeds(
      [job('docs', 'success', { artifact_name: 'docs', has_changes: 'false' }), job('format', 'skipped')],
      'has_changes',
      'artifact_name',
      'generated-files',
    );

    expect(evaluation).toEqual({ artifacts: [], failedJobs: [], pendingJobs: [] });
  });

  it('lists failed and cancelled jobs, in needs order', () => {
    const evaluation = evaluateNeeds(
      [job('a', 'failure'), job('b', 'success'), job('c', 'cancelled')],
      'has_changes',
      'artifact_name',
      'generated-files',
    );

    expect(evaluation.failedJobs).toEqual(['a', 'c']);
  });

  it('lists pending jobs with their artifacts, in needs order', () => {
    const evaluation = evaluateNeeds(
      [
        job('lock', 'success', { artifact_name: 'cargo-lock', has_changes: 'true' }),
        job('docs', 'success', { artifact_name: 'docs', has_changes: 'false' }),
        job('format', 'success', { artifact_name: 'rust-auto-format', has_changes: 'true' }),
      ],
      'has_changes',
      'artifact_name',
      'generated-files',
    );

    expect(evaluation.pendingJobs).toEqual(['lock', 'format']);
    expect(evaluation.artifacts).toEqual(['cargo-lock', 'rust-auto-format']);
  });

  it('reads the output names it is given', () => {
    const evaluation = evaluateNeeds(
      [job('fmt', 'success', { changes_detected: 'true', patch: 'fmt' })],
      'changes_detected',
      'patch',
      'generated-files',
    );

    expect(evaluation.artifacts).toEqual(['fmt']);
  });

  it('counts only exactly true as pending', () => {
    const evaluation = evaluateNeeds(
      [job('docs', 'success', { artifact_name: 'docs', has_changes: 'TRUE' })],
      'has_changes',
      'artifact_name',
      'generated-files',
    );

    expect(evaluation.pendingJobs).toEqual([]);
  });

  it('refuses a pending job that names no artifact', () => {
    expect(() =>
      evaluateNeeds(
        [job('docs', 'success', { has_changes: 'true' })],
        'has_changes',
        'artifact_name',
        'generated-files',
      ),
    ).toThrow(/docs reports changes but sets no artifact_name output/);
  });

  it('refuses two pending jobs with the same artifact', () => {
    expect(() =>
      evaluateNeeds(
        [
          job('a', 'success', { artifact_name: 'same', has_changes: 'true' }),
          job('b', 'success', { artifact_name: 'same', has_changes: 'true' }),
        ],
        'has_changes',
        'artifact_name',
        'generated-files',
      ),
    ).toThrow(/two jobs uploaded an artifact named same/);
  });

  it('refuses an artifact name create-patch would not accept', () => {
    expect(() =>
      evaluateNeeds(
        [job('a', 'success', { artifact_name: '../x', has_changes: 'true' })],
        'has_changes',
        'artifact_name',
        'generated-files',
      ),
    ).toThrow();
  });

  it('refuses a generator artifact named like the merged patch, pending or not', () => {
    expect(() =>
      evaluateNeeds(
        [job('docs', 'success', { artifact_name: 'generated-files', has_changes: 'false' })],
        'has_changes',
        'artifact_name',
        'generated-files',
      ),
    ).toThrow(/docs uploaded an artifact named generated-files/);
  });
});

describe('downloadPattern', () => {
  it('is empty for no artifacts', () => {
    expect(downloadPattern([])).toBe('');
  });

  it('is the name itself for one artifact', () => {
    expect(downloadPattern(['docs-render'])).toBe('docs-render');
  });

  it('is a brace set for several', () => {
    expect(downloadPattern(['a', 'b.c', 'd_e'])).toBe('{a,b.c,d_e}');
  });
});

describe('inspectPatches and applyPatches', () => {
  let repository: string;
  let downloads: string;

  async function git(...args: string[]): Promise<string> {
    return runGitText(['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: repository });
  }

  /** Writes an artifact directory the way create-patch uploads it. */
  async function artifact(name: string, baseSha: string, patch: string): Promise<void> {
    const directory = path.join(downloads, name);
    await mkdir(directory);
    const bytes = Buffer.from(patch);
    await writeFile(path.join(directory, 'changes.patch'), bytes);
    await writeFile(path.join(directory, 'metadata.json'), serializeMetadata(describePatch(baseSha, bytes)));
  }

  /** The patch that turns the committed `file` into `content`, made with the working tree. */
  async function diffFor(file: string, content: string): Promise<string> {
    const original = await readFile(path.join(repository, file), 'utf8');
    await writeFile(path.join(repository, file), content);
    const patch = (
      await runGit(['diff', '--binary', '--full-index', '--src-prefix=a/', '--dst-prefix=b/'], { cwd: repository })
    ).toString('utf8');
    await writeFile(path.join(repository, file), original);
    return patch;
  }

  beforeEach(async () => {
    repository = await mkdtemp(path.join(tmpdir(), 'verdict-repo-'));
    downloads = await mkdtemp(path.join(tmpdir(), 'verdict-downloads-'));
    await runGit(['init', '--quiet'], { cwd: repository });
    // A developer's global core.autocrlf would rewrite the files the assertions read.
    await runGit(['config', 'core.autocrlf', 'false'], { cwd: repository });
    await writeFile(path.join(repository, 'README.md'), 'one\ntwo\nthree\n');
    await writeFile(path.join(repository, 'Cargo.lock'), 'lock v1\n');
    await git('add', '--all');
    await git('commit', '--quiet', '-m', 'seed');
  });

  afterEach(async () => {
    await rm(repository, { force: true, recursive: true });
    await rm(downloads, { force: true, recursive: true });
  });

  it('returns the shared base and applies every patch in order', async () => {
    const head = await git('rev-parse', 'HEAD');
    await artifact('docs', head, await diffFor('README.md', 'one\nTWO\nthree\n'));
    await artifact('lock', head, await diffFor('Cargo.lock', 'lock v2\n'));

    const { baseSha, patches } = await inspectPatches(downloads, ['docs', 'lock'], 1024 * 1024);
    await applyPatches(repository, ['docs', 'lock'], patches);

    expect(baseSha).toBe(head);
    expect(await readFile(path.join(repository, 'README.md'), 'utf8')).toBe('one\nTWO\nthree\n');
    expect(await readFile(path.join(repository, 'Cargo.lock'), 'utf8')).toBe('lock v2\n');
  });

  it('skips an empty patch', async () => {
    const head = await git('rev-parse', 'HEAD');
    await artifact('empty', head, '');

    const { patches } = await inspectPatches(downloads, ['empty'], 1024);
    await applyPatches(repository, ['empty'], patches);

    expect(await git('status', '--porcelain')).toBe('');
  });

  it('refuses patches made from different commits', async () => {
    await artifact('docs', BASE, '');
    await artifact('lock', OTHER, '');

    await expect(inspectPatches(downloads, ['docs', 'lock'], 1024)).rejects.toThrow(MixedBaseError);
  });

  it('refuses a directory that is not a create-patch artifact', async () => {
    await mkdir(path.join(downloads, 'docs'));
    await writeFile(path.join(downloads, 'docs', 'changes.patch'), '');

    await expect(inspectPatches(downloads, ['docs'], 1024)).rejects.toThrow(/expected exactly/);
  });

  it('refuses an empty artifact list', async () => {
    await expect(inspectPatches(downloads, [], 1024)).rejects.toThrow(/artifacts is empty/);
  });

  it('names the patch that conflicts with an earlier one', async () => {
    const head = await git('rev-parse', 'HEAD');
    await artifact('first', head, await diffFor('README.md', 'one\nfirst\nthree\n'));
    await artifact('second', head, await diffFor('README.md', 'one\nsecond\nthree\n'));

    const { patches } = await inspectPatches(downloads, ['first', 'second'], 1024 * 1024);
    const failure = applyPatches(repository, ['first', 'second'], patches);

    await expect(failure).rejects.toThrow(PatchConflictError);
    await expect(failure).rejects.toThrow(/The second patch/);
  });

  it('refuses a patch that writes outside the work tree', async () => {
    const head = await git('rev-parse', 'HEAD');
    const escape = [
      'diff --git a/../escape.txt b/../escape.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/../escape.txt',
      '@@ -0,0 +1 @@',
      '+outside',
      '',
    ].join('\n');
    await artifact('evil', head, escape);

    const { patches } = await inspectPatches(downloads, ['evil'], 1024);

    await expect(applyPatches(repository, ['evil'], patches)).rejects.toThrow(PatchConflictError);
  });
});
