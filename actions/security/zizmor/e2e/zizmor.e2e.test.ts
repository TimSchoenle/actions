import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { runAction, StubCommands, Workspace } from 'actions-e2e';
import { afterEach, describe, expect, it } from 'vitest';

import { BOM, dockerRules, fileAnnotations, HELPER_DIRECTORY, IMAGE, sarif, TOKEN, WORKFLOW } from './support.js';

import type { ActionInput, ActionOutput } from '../helper/src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs, StubRule, WorkspaceFiles } from 'actions-e2e';

/**
 * End-to-end cases for `actions/security/zizmor`.
 *
 * The composite runs the helper bundle twice, as `scan` and as `gate`. These cases drive that bundle
 * with the `INPUT_*` names the composite passes, against a stub `docker` on `PATH`: the end-to-end job
 * has no Docker daemon, and the argument vector the container is started with is the thing worth
 * asserting. `extra-jobs.yaml` runs the composite with the real image.
 */

describe('security/zizmor', () => {
  let workspace: Workspace | undefined;
  let stubs: StubCommands | undefined;

  afterEach(async () => {
    await workspace?.dispose();
    await stubs?.dispose();
    workspace = undefined;
    stubs = undefined;
  });

  async function scan(
    inputs: ProvidedInputs<ActionInput> = {},
    expected: ExpectedOutcome = 'success',
    files: WorkspaceFiles = { '.github/workflows/ci.yml': WORKFLOW },
    docker: StubRule[] = dockerRules(),
    env: Readonly<Record<string, string>> = {},
  ): Promise<ActionRunResult<ActionOutput>> {
    workspace = await Workspace.create(files);
    stubs = await StubCommands.create({ docker });

    return runAction<ActionInput, ActionOutput>({
      actionDirectory: HELPER_DIRECTORY,
      inputs: { mode: 'scan', image: IMAGE, token: TOKEN, ...inputs },
      env: { PATH: stubs.pathPrepended(), ...env },
      secrets: [TOKEN],
      workspace,
      expect: expected,
    });
  }

  async function dockerArguments(): Promise<string[][]> {
    return (await stubs?.argumentsOf('docker')) ?? [];
  }

  describe('scan', () => {
    it('runs zizmor with the defaults, in a locked-down container, and publishes the SARIF', async () => {
      const result = await scan();
      const [args] = await dockerArguments();

      expect(args).toEqual([
        'run',
        '--rm',
        '--read-only',
        '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=256m',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--user=65534:65534',
        `--mount=type=bind,source=${workspace?.path},target=/workspace,readonly`,
        '--workdir=/workspace',
        '--env=GH_TOKEN',
        IMAGE,
        '--persona=pedantic',
        '--format=sarif',
        '--color=never',
        '--cache-dir=/tmp/zizmor',
        '--strict-collection',
        '--',
        '.',
      ]);
      expect(result.outputs['upload']).toBe('true');
    });

    // The harness removes RUNNER_TEMP after a run, so this case brings its own to read the file back.
    it('writes the SARIF under RUNNER_TEMP, in a directory of its own', async () => {
      const temp = await mkdtemp(join(tmpdir(), 'zizmor-e2e-temp-'));

      try {
        const result = await scan({}, 'success', undefined, undefined, { RUNNER_TEMP: temp });
        const sarifFile = result.outputs['sarif_file'] ?? '';

        expect(dirname(dirname(sarifFile))).toBe(temp);
        expect(basename(sarifFile)).toBe('results.sarif');
        await expect(readFile(sarifFile, 'utf8')).resolves.toBe(sarif());
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    });

    it('masks the token and keeps it out of the argument vector', async () => {
      const result = await scan();

      expect(result.masks).toContain(TOKEN);
      expect((await dockerArguments()).flat().join(' ')).not.toContain(TOKEN);
    });

    it('drops strict collection and online audits, and with them the network and the token', async () => {
      await scan({ online_audits: 'false', strict_collection: 'false', token: '' });
      const [args = []] = await dockerArguments();

      expect(args).toContain('--no-online-audits');
      expect(args).toContain('--network=none');
      expect(args).not.toContain('--strict-collection');
      expect(args).not.toContain('--env=GH_TOKEN');
    });

    it('passes every input path, a configuration file and the filters', async () => {
      await scan(
        {
          inputs: '.\n# The release workflows live outside .github.\nworkflows/release/workflow.yaml\n',
          config: '.github/zizmor.yml',
          min_severity: 'low',
          min_confidence: 'medium',
          persona: 'auditor',
        },
        'success',
        {
          '.github/workflows/ci.yml': WORKFLOW,
          '.github/zizmor.yml': 'rules: {}\n',
          'workflows/release/workflow.yaml': WORKFLOW,
        },
      );
      const [args = []] = await dockerArguments();

      expect(args.slice(args.indexOf(IMAGE) + 1)).toEqual([
        '--persona=auditor',
        '--format=sarif',
        '--color=never',
        '--cache-dir=/tmp/zizmor',
        '--strict-collection',
        '--min-severity=low',
        '--min-confidence=medium',
        '--config=.github/zizmor.yml',
        '--',
        '.',
        'workflows/release/workflow.yaml',
      ]);
    });

    it('echoes upload false for the composite to skip the upload', async () => {
      const result = await scan({ upload: 'false' });

      expect(result.outputs['upload']).toBe('false');
    });

    it.each(['-', '--version', '--fix=all'])(
      'refuses an inputs line of %j before the container starts',
      async (line) => {
        const result = await scan({ inputs: `.\n${line}` }, 'failure');

        expect(result.errors.join('\n')).toContain('inputs:');
        expect(await dockerArguments()).toEqual([]);
        expect(result.outputs).toEqual({});
      },
    );

    it('refuses persona strict and names the three valid personas', async () => {
      const result = await scan({ persona: 'strict' }, 'failure');

      expect(result.errors.join('\n')).toContain('persona: "strict" is not one of regular, pedantic, auditor.');
      expect(await dockerArguments()).toEqual([]);
    });

    it('refuses a typo in fail-on-severity before the container starts', async () => {
      const result = await scan({ fail_on_severity: 'critical' }, 'failure');

      expect(result.errors.join('\n')).toContain('fail-on-severity');
      expect(await dockerArguments()).toEqual([]);
    });

    it('refuses an empty token with online audits on, which zizmor would answer by skipping them', async () => {
      const result = await scan({ token: '' }, 'failure');

      expect(result.errors.join('\n')).toContain('token: is empty');
      expect(await dockerArguments()).toEqual([]);
    });

    it('refuses a path that does not exist, which zizmor would fetch as a repository', async () => {
      const result = await scan({ inputs: 'zizmorcore/zizmor' }, 'failure');

      expect(result.errors.join('\n')).toContain('does not exist in the workspace');
      expect(await dockerArguments()).toEqual([]);
    });
  });

  describe('byte order marks', () => {
    const MARKED: WorkspaceFiles = {
      '.github/workflows/a.yml': `${BOM}${WORKFLOW}`,
      '.github/workflows/clean.yml': WORKFLOW,
      'actions/setup/action.yml': `${BOM}name: setup\n`,
      // Not collected by zizmor, so a BOM here is none of this action's business.
      'docker-compose.yml': `${BOM}services: {}\n`,
    };

    it('annotates every marked file and fails before the container starts, with strict collection on', async () => {
      const result = await scan({}, 'failure', MARKED);

      expect(fileAnnotations(result, 'error')).toEqual(['.github/workflows/a.yml', 'actions/setup/action.yml']);
      expect(result.errors.join('\n')).toContain('2 input file(s) start with a UTF-8 byte order mark');
      expect(await dockerArguments()).toEqual([]);
    });

    it('warns about each and runs zizmor anyway, with strict collection off', async () => {
      const result = await scan({ strict_collection: 'false' }, 'success', MARKED);

      expect(fileAnnotations(result, 'warning')).toEqual(['.github/workflows/a.yml', 'actions/setup/action.yml']);
      expect(fileAnnotations(result, 'error')).toEqual([]);
      expect(await dockerArguments()).toHaveLength(1);
    });

    it('skips what .gitignore excludes, as zizmor does', async () => {
      workspace = await Workspace.create({
        '.gitignore': 'vendor/\n',
        'vendor/action.yml': `${BOM}name: vendored\n`,
        '.github/workflows/ci.yml': WORKFLOW,
      });
      await workspace.initGit();
      stubs = await StubCommands.create({ docker: dockerRules() });

      const result = await runAction<ActionInput, ActionOutput>({
        actionDirectory: HELPER_DIRECTORY,
        inputs: { mode: 'scan', image: IMAGE, token: TOKEN },
        env: { PATH: stubs.pathPrepended() },
        workspace,
        expect: 'success',
      });

      expect(fileAnnotations(result, 'error')).toEqual([]);
    });

    it('checks a file named in inputs whatever its name', async () => {
      const result = await scan({ inputs: 'fixtures/odd.yml' }, 'failure', {
        'fixtures/odd.yml': `${BOM}${WORKFLOW}`,
      });

      expect(fileAnnotations(result, 'error')).toEqual(['fixtures/odd.yml']);
    });
  });

  describe('zizmor exit codes', () => {
    it.each([
      [1, 'could not load an input'],
      [3, 'collected no inputs'],
      [125, 'ghcr.io:443'],
    ])('explains exit %i and publishes no SARIF', async (exitCode, expected) => {
      const result = await scan(
        {},
        'failure',
        undefined,
        dockerRules({ exitCode, stderr: 'failed to load file://x\n' }),
      );

      expect(result.errors.join('\n')).toContain(expected);
      expect(result.outputs['sarif_file']).toBeUndefined();
    });

    it("relays zizmor's log, which names the file it could not load", async () => {
      const result = await scan(
        {},
        'failure',
        undefined,
        dockerRules({
          exitCode: 1,
          stderr: 'fatal: no audit was performed\nfailed to load file://./.github/workflows/ci.yml as workflow\n',
        }),
      );

      expect(result.stdout).toContain('| failed to load file://./.github/workflows/ci.yml as workflow');
    });

    it('refuses a run that exits 0 without writing SARIF', async () => {
      const result = await scan({}, 'failure', undefined, dockerRules({ stdout: 'not sarif' }));

      expect(result.errors.join('\n')).toContain('not JSON');
      expect(result.outputs['sarif_file']).toBeUndefined();
    });

    it('fails with a reason when docker is not installed', async () => {
      workspace = await Workspace.create({ '.github/workflows/ci.yml': WORKFLOW });
      stubs = await StubCommands.create({});

      const result = await runAction<ActionInput, ActionOutput>({
        actionDirectory: HELPER_DIRECTORY,
        inputs: { mode: 'scan', image: IMAGE, token: TOKEN },
        // Only the empty stub directory: the machine's own PATH may well hold a docker.
        env: { PATH: stubs.path },
        workspace,
        expect: 'failure',
      });

      expect(result.errors.join('\n')).toContain('docker could not be started');
    });
  });

  describe('gate', () => {
    async function gate(
      contents: string | undefined,
      inputs: ProvidedInputs<ActionInput> = {},
      expected: ExpectedOutcome = 'success',
    ): Promise<ActionRunResult<ActionOutput>> {
      workspace = await Workspace.create();
      const sarifFile = join(workspace.path, 'results.sarif');

      if (contents !== undefined) {
        await writeFile(sarifFile, contents, 'utf8');
      }

      return runAction<ActionInput, ActionOutput>({
        actionDirectory: HELPER_DIRECTORY,
        inputs: { mode: 'gate', sarif_file: sarifFile, ...inputs },
        workspace,
        expect: expected,
      });
    }

    it('fails on one high finding at medium, counting the low one too', async () => {
      const result = await gate(sarif('Low', 'High'), { fail_on_severity: 'medium' }, 'failure');

      expect(result.outputs).toEqual({ findings: '2', failing: '1' });
      expect(result.errors.join('\n')).toContain('1 zizmor finding(s) at or above medium');
      expect(result.stdout).toContain('high: "zizmor/rule-1" in ".github/workflows/ci.yml" line 2');
      expect(result.stepSummary).toContain('2 finding(s), 1 at or above <code>medium</code>.');
    });

    it('never fails with none', async () => {
      const result = await gate(sarif('Low', 'High'), { fail_on_severity: 'none' });

      expect(result.outputs).toEqual({ findings: '2', failing: '0' });
    });

    it('fails on an informational finding with the default threshold', async () => {
      const result = await gate(sarif('Informational'), {}, 'failure');

      expect(result.outputs).toEqual({ findings: '1', failing: '1' });
    });

    it('passes a SARIF with no results', async () => {
      const result = await gate(sarif());

      expect(result.outputs).toEqual({ findings: '0', failing: '0' });
      expect(result.stepSummary).toContain('0 finding(s), 0 at or above');
    });

    it('fails on a SARIF path that does not exist, never reading it as zero findings', async () => {
      const result = await gate(undefined, {}, 'failure');

      expect(result.errors.join('\n')).toContain('cannot be read');
      expect(result.outputs).toEqual({});
    });

    it('counts a finding with no severity as failing, so a renamed property cannot pass everything', async () => {
      const result = await gate(sarif(undefined, 'Critical'), { fail_on_severity: 'high' }, 'failure');

      expect(result.outputs).toEqual({ findings: '2', failing: '2' });
    });
  });
});
