import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAction, StubCommands } from 'actions-e2e';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../helper/src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * End-to-end cases for `actions/docker/image-check`.
 *
 * The composite's own steps — Trivy, upload-sarif, upsert-pr-comment, upload-artifact — can only be
 * run by the runner, and `extra-jobs.yaml` runs them for real against an image built in the job.
 * These cases cover everything between those steps: the shipped helper bundle, driven through the
 * three phases exactly as the composite drives it, with the `INPUT_*` names and the plan file the
 * composite passes. Docker is a stub, because the end-to-end job has no daemon and blocks egress;
 * what the stub fakes is the size, and what the cases assert on is everything decided from it.
 */

const HELPER_DIRECTORY = fileURLToPath(new URL('../helper', import.meta.url));
const SUMMARY_HELPER_DIRECTORY = fileURLToPath(new URL('../../image-check-summary/helper', import.meta.url));

const REPOSITORY = 'TimSchoenle/actions-testing';
const IMAGE = 'image-check-e2e:test';
const MIB = 1_048_576;

/** What Trivy writes for an image with findings: one run, its results. */
function sarif(findings: number): string {
  return JSON.stringify({
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'Trivy' } },
        results: Array.from({ length: findings }, (_, i) => ({ ruleId: `CVE-${i}` })),
      },
    ],
  });
}

interface Scene {
  sizeBytes?: number;
  /** Head repository of the pull request; `null` runs on a push. */
  headRepository?: string | null;
}

describe('image-check', () => {
  let root: string;
  /** The stubs of the most recent job; every one created is disposed after the case. */
  let stubs: StubCommands;
  let created: StubCommands[] = [];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'image-check-e2e-'));
    await mkdir(path.join(root, 'temp'));
  });

  afterEach(async () => {
    for (const stub of created) {
      await stub.dispose();
    }

    created = [];
    await rm(root, { recursive: true, force: true });
  });

  /** The environment the runner gives every step of one job, shared by every phase. */
  async function jobEnvironment(scene: Scene): Promise<Record<string, string>> {
    stubs = await StubCommands.create({
      docker: [
        { when: ['inspect', IMAGE], stdout: `${scene.sizeBytes ?? 87 * MIB}\n` },
        { when: ['inspect'], exitCode: 1, stderr: 'Error response from daemon: No such image: missing:test\n' },
      ],
    });
    created.push(stubs);

    const env: Record<string, string> = {
      PATH: stubs.pathPrepended(),
      // The harness gives each run a fresh RUNNER_TEMP and removes it afterwards; the phases share
      // one, as the steps of a job do, because the plan file lives there.
      RUNNER_TEMP: path.join(root, 'temp'),
      GITHUB_REPOSITORY: REPOSITORY,
    };

    const headRepository = scene.headRepository === undefined ? REPOSITORY : scene.headRepository;

    if (headRepository !== null) {
      const eventPath = path.join(root, 'event.json');
      await writeFile(
        eventPath,
        JSON.stringify({ pull_request: { number: 42, head: { repo: { full_name: headRepository } } } }),
      );
      env['GITHUB_EVENT_PATH'] = eventPath;
    }

    return env;
  }

  function phase(
    env: Record<string, string>,
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({ actionDirectory: HELPER_DIRECTORY, inputs, env, expect: expected });
  }

  /** Runs the three phases with Trivy's SARIF in between, as the composite does. */
  async function check(
    inputs: ProvidedInputs<ActionInput>,
    scene: Scene = {},
    findings = 3,
    enforceOutcome: ExpectedOutcome = 'success',
  ) {
    const env = await jobEnvironment(scene);
    const measure = await phase(env, { phase: 'measure', image: IMAGE, ...inputs });
    const plan = measure.outputs['plan'] ?? '';

    await writeFile(measure.outputs['sarif_path'] ?? '', sarif(findings));

    const report = await phase(env, { phase: 'report', plan });
    const enforce = await phase(env, { phase: 'enforce', plan }, enforceOutcome);

    return { env, measure, report, enforce };
  }

  describe('per-image, on a pull request from the same repository', () => {
    it('measures, reports and passes, publishing the comment and the SARIF', async () => {
      const { measure, report, enforce } = await check({ platform: 'linux/amd64' });

      expect(measure.outputs).toMatchObject({
        image: IMAGE,
        size_bytes: String(87 * MIB),
        size_mib: '87.0',
        over_warning: 'false',
        sarif_category: 'trivy-linux-amd64',
        comment_identifier: 'docker-image-size-linux-amd64',
        upload_sarif: 'true',
        write_comment: 'true',
        upload_fragment: 'false',
      });
      expect(report.outputs['findings']).toBe('3');
      expect(report.outputs['comment_body']).toBe(
        '**Docker image** `linux/amd64`: 87.0 MiB (uncompressed), warning above 150 MiB.\n' +
          `Trivy: 3 findings at CRITICAL,HIGH. [Code scanning](https://github.com/${REPOSITORY}/security/code-scanning?query=pr%3A42)`,
      );
      expect(report.stepSummary).toContain(`| \`${IMAGE}\` | \`linux/amd64\` | 87.0 | 3 at CRITICAL,HIGH |`);
      expect(enforce.errors).toEqual([]);
      expect(enforce.warnings).toEqual([]);
    });

    it('asks docker for the size alone, with the reference after the end of options', async () => {
      await check({});

      expect(await stubs.argumentsOf('docker')).toEqual([['image', 'inspect', '--format', '{{.Size}}', '--', IMAGE]]);
    });

    it('keeps the default SARIF category and identifier without a platform', async () => {
      const { measure } = await check({});

      expect(measure.outputs['sarif_category']).toBe('');
      expect(measure.outputs['comment_identifier']).toBe('docker-image-size');
    });

    it('writes the SARIF under RUNNER_TEMP, never the workspace', async () => {
      const { env, measure } = await check({});

      expect(path.relative(env['RUNNER_TEMP'], measure.outputs['sarif_path'] ?? '').startsWith('..')).toBe(false);
      expect(path.relative(measure.workspace, measure.outputs['sarif_path'] ?? '').startsWith('..')).toBe(true);
    });
  });

  describe('gates', () => {
    it('warns above the warning threshold without failing', async () => {
      const { measure, enforce } = await check({}, { sizeBytes: 162 * MIB });

      expect(measure.outputs['over_warning']).toBe('true');
      expect(enforce.warnings.join('\n')).toContain('above the 150 MiB warning threshold');
    });

    // The order is the design: the report has already run when the gate fails, so the comment and
    // the step summary carry the reason the build went red.
    it('fails above the limit only after the report was published', async () => {
      const { report, enforce } = await check({ size_limit_mib: '100' }, { sizeBytes: 162 * MIB }, 3, 'failure');

      expect(report.outputs['comment_body']).toContain('above the 100 MiB limit');
      expect(enforce.errors.join('\n')).toContain('above the 100 MiB limit (size-limit-mib)');
    });

    it('fails on findings only when asked to', async () => {
      const advisory = await check({});
      expect(advisory.enforce.exitCode).toBe(0);

      const enforced = await check({ trivy_fail_on_findings: 'true' }, {}, 1, 'failure');
      expect(enforced.enforce.errors.join('\n')).toContain('trivy-fail-on-findings is true');
    });

    it('passes an enforced findings gate on a clean scan', async () => {
      const { enforce } = await check({ trivy_fail_on_findings: 'true' }, {}, 0);

      expect(enforce.errors).toEqual([]);
    });
  });

  describe('a pull request from a fork', () => {
    it('skips the SARIF upload and the comment, with a notice, and still writes the step summary', async () => {
      const { measure, report } = await check(
        { platform: 'linux/amd64' },
        { headRepository: 'mallory/actions-testing' },
      );

      expect(measure.outputs).toMatchObject({
        upload_sarif: 'false',
        write_comment: 'false',
        upload_fragment: 'false',
      });
      expect(measure.notices.join('\n')).toContain('GITHUB_TOKEN is read-only');
      expect(report.outputs['comment_body']).toBeUndefined();
      expect(report.stepSummary).toContain('| `linux/amd64` |');
    });

    it('treats a deleted fork, which has no head repository, as a fork', async () => {
      const env = await jobEnvironment({});
      await writeFile(env['GITHUB_EVENT_PATH'], JSON.stringify({ pull_request: { number: 42, head: { repo: null } } }));

      const measure = await phase(env, { phase: 'measure', image: IMAGE });

      expect(measure.outputs['write_comment']).toBe('false');
    });
  });

  describe('on a push', () => {
    it('uploads the SARIF and comments nowhere', async () => {
      const { measure, report } = await check({}, { headRepository: null });

      expect(measure.outputs).toMatchObject({ upload_sarif: 'true', write_comment: 'false', upload_fragment: 'false' });
      expect(report.outputs['comment_body']).toBeUndefined();
    });
  });

  describe('summary mode with two platforms', () => {
    it('writes one fragment per leg, which the summary renders as one sorted table', async () => {
      const legs = [
        { platform: 'linux/arm64', sizeBytes: 162 * MIB },
        { platform: 'linux/amd64', sizeBytes: 87 * MIB },
      ];
      const downloads = path.join(root, 'downloads');

      for (const leg of legs) {
        const { measure } = await check({ platform: leg.platform, comment: 'summary' }, { sizeBytes: leg.sizeBytes });

        expect(measure.outputs['upload_fragment']).toBe('true');
        expect(measure.outputs['write_comment']).toBe('false');

        // What upload-artifact and download-artifact do between the jobs: one directory per artifact.
        const artifact = path.join(downloads, measure.outputs['fragment_name'] ?? '');
        await mkdir(artifact, { recursive: true });
        await writeFile(
          path.join(artifact, 'fragment.json'),
          await readFile(measure.outputs['fragment_path'] ?? '', 'utf8'),
        );
      }

      const summary = await runAction<'directory', 'body' | 'images' | 'write_comment'>({
        actionDirectory: SUMMARY_HELPER_DIRECTORY,
        inputs: { directory: downloads },
        env: await jobEnvironment({}),
      });

      expect(summary.outputs['images']).toBe('2');
      expect(summary.outputs['write_comment']).toBe('true');
      expect(summary.outputs['body']).toBe(
        [
          '**Docker images**',
          '',
          '| Platform | Size (MiB, uncompressed) | Trivy findings |',
          '| --- | --- | --- |',
          '| `linux/amd64` | 87.0 | 3 |',
          '| `linux/arm64` | 162.0 (above 150) | 3 |',
          '',
          'Trivy findings at CRITICAL,HIGH.',
        ].join('\n'),
      );
    });

    it('refuses summary mode without a platform, before running docker', async () => {
      const env = await jobEnvironment({});

      const result = await phase(env, { phase: 'measure', image: IMAGE, comment: 'summary' }, 'failure');

      expect(result.errors.join('\n')).toContain("platform: is required when comment is 'summary'");
      expect(await stubs.invocations()).toEqual([]);
    });
  });

  describe('refusals', () => {
    it('fails at once, naming the reference, when the image was never loaded', async () => {
      const env = await jobEnvironment({});

      const result = await phase(env, { phase: 'measure', image: 'missing:test' }, 'failure');

      expect(result.errors.join('\n')).toContain("Image 'missing:test' is not in the Docker daemon");
    });

    it('refuses an image reference that docker would read as a flag, and runs nothing', async () => {
      const env = await jobEnvironment({});

      const result = await phase(env, { phase: 'measure', image: '--help' }, 'failure');

      expect(result.errors.join('\n')).toContain('image:');
      expect(await stubs.invocations()).toEqual([]);
    });

    it('refuses a report phase pointed outside RUNNER_TEMP', async () => {
      const env = await jobEnvironment({});
      const outside = path.join(root, 'plan.json');
      await writeFile(outside, '{}');

      const result = await phase(env, { phase: 'report', plan: outside }, 'failure');

      expect(result.errors.join('\n')).toContain('not under RUNNER_TEMP');
    });
  });
});
