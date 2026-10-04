import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAction } from 'actions-e2e';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../helper/src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome } from 'actions-e2e';

/**
 * End-to-end cases for `actions/docker/image-check-summary`.
 *
 * download-artifact and upsert-pr-comment are the runner's to run, and `docker/image-check`'s
 * `extra-jobs.yaml` runs both for real behind a matrix of legs. These cases drive the shipped helper
 * bundle over the two directory layouts download-artifact produces, and over the events that decide
 * whether the table may be posted at all.
 */

const HELPER_DIRECTORY = fileURLToPath(new URL('../helper', import.meta.url));

const REPOSITORY = 'TimSchoenle/actions-testing';

function fragment(platform: string, findings = 0, sizeBytes = 1_048_576): string {
  return JSON.stringify({
    version: 1,
    platform,
    image: 'image-check-e2e:test',
    size_bytes: sizeBytes,
    warning_mib: 150,
    findings,
    severity: 'CRITICAL,HIGH',
  });
}

describe('image-check-summary', () => {
  let root: string;
  let downloads: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'image-check-summary-e2e-'));
    downloads = path.join(root, 'downloads');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function artifacts(files: Record<string, string>): Promise<void> {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(path.join(downloads, name), { recursive: true });
      await writeFile(path.join(downloads, name, 'fragment.json'), content);
    }
  }

  /** `null` runs on a push, with no pull request in the event. */
  async function summarize(
    headRepository: string | null = REPOSITORY,
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    const env: Record<string, string> = { GITHUB_REPOSITORY: REPOSITORY };

    if (headRepository !== null) {
      env['GITHUB_EVENT_PATH'] = path.join(root, 'event.json');
      await writeFile(
        env['GITHUB_EVENT_PATH'],
        JSON.stringify({ pull_request: { number: 42, head: { repo: { full_name: headRepository } } } }),
      );
    }

    return runAction<ActionInput, ActionOutput>({
      actionDirectory: HELPER_DIRECTORY,
      inputs: { directory: downloads },
      env,
      expect: expected,
    });
  }

  it('renders every leg as one row, sorted by platform, and asks for the comment', async () => {
    await artifacts({
      'image-check-linux-arm64': fragment('linux/arm64', 1, 162 * 1_048_576),
      'image-check-linux-amd64': fragment('linux/amd64', 2),
    });

    const result = await summarize();

    expect(result.outputs).toMatchObject({ images: '2', write_comment: 'true' });
    expect(result.outputs['body']).toContain('| `linux/amd64` | 1.0 | 2 |\n| `linux/arm64` | 162.0 (above 150) | 1 |');
    expect(result.stepSummary).toContain('**Docker images**');
  });

  it('reads a lone artifact, which download-artifact extracts straight into the path', async () => {
    await mkdir(downloads, { recursive: true });
    await writeFile(path.join(downloads, 'fragment.json'), fragment('linux/amd64'));

    const result = await summarize();

    expect(result.outputs['images']).toBe('1');
  });

  it('reads a pattern that matched nothing as no fragments, and warns rather than posting an empty table', async () => {
    const result = await summarize();

    expect(result.outputs).toMatchObject({ images: '0', write_comment: 'false' });
    expect(result.warnings.join('\n')).toContain('Found no docker/image-check fragments');
  });

  it('skips the comment on a fork, with a notice, and keeps the table in the step summary', async () => {
    await artifacts({ 'image-check-linux-amd64': fragment('linux/amd64') });

    const result = await summarize('mallory/actions-testing');

    expect(result.outputs['write_comment']).toBe('false');
    expect(result.notices.join('\n')).toContain('GITHUB_TOKEN is read-only');
    expect(result.stepSummary).toContain('`linux/amd64`');
  });

  it('comments nowhere on a push', async () => {
    await artifacts({ 'image-check-linux-amd64': fragment('linux/amd64') });

    const result = await summarize(null);

    expect(result.outputs).toMatchObject({ images: '1', write_comment: 'false' });
    expect(result.warnings).toEqual([]);
  });

  it('keeps the last of two fragments for one platform, and warns naming it', async () => {
    await artifacts({ a: fragment('linux/amd64', 1), b: fragment('linux/amd64', 7) });

    const result = await summarize();

    expect(result.outputs['images']).toBe('1');
    expect(result.outputs['body']).toContain('| `linux/amd64` | 1.0 | 7 |');
    expect(result.warnings.join('\n')).toContain('linux/amd64');
  });

  it('fails on a fragment a different release wrote, naming the artifact', async () => {
    await artifacts({
      'image-check-linux-amd64': JSON.stringify({ ...JSON.parse(fragment('linux/amd64')), version: 2 }),
    });

    const result = await summarize(REPOSITORY, 'failure');

    expect(result.errors.join('\n')).toContain('image-check-linux-amd64/fragment.json');
    expect(result.errors.join('\n')).toContain('same release');
  });

  // The platform lands in a code span and the image in a table cell, unescaped.
  it('refuses a fragment that would break out of the table', async () => {
    await artifacts({ 'image-check-x': fragment('linux/amd64` | injected | `') });

    const result = await summarize(REPOSITORY, 'failure');

    expect(result.errors.join('\n')).toContain("'platform'");
    expect(result.outputs['body']).toBeUndefined();
  });
});
