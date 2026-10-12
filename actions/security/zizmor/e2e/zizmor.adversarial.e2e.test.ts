import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  commandInjectionPayload,
  DECEPTIVE_PATHS,
  expectCleanRejection,
  expectNoCrash,
  expectNoInjection,
  expectSecretNotLeaked,
  FORGERY_MARKER,
  INPUT_HOSTILE_CHARACTERS,
  linkOutside,
  RUNNER_LINE_BREAKS,
  runAction,
  StubCommands,
  TRAVERSAL_PATHS,
  Workspace,
} from 'actions-e2e';
import { afterEach, describe, expect, it } from 'vitest';

import { BOM, dockerRules, fileAnnotations, HELPER_DIRECTORY, IMAGE, sarif, TOKEN, WORKFLOW } from './support.js';

import type { ActionInput, ActionOutput } from '../helper/src/generated/action-io.js';
import type {
  ActionRunResult,
  ExpectedOutcome,
  OutsideTarget,
  ProvidedInputs,
  StubRule,
  WorkspaceFiles,
} from 'actions-e2e';

/**
 * Hostile inputs, hostile repository content and a hostile zizmor log, against the shipped helper.
 *
 * Three trust boundaries meet in this action. The inputs come from a workflow, which may interpolate
 * pull request data into them. The files come from the pull request itself. And zizmor's log and
 * SARIF repeat names and text from those files. Each case asserts the step either refuses cleanly or
 * carries the value through without letting it become a workflow command, a flag, or a path outside
 * the workspace.
 */

describe('security/zizmor (adversarial)', () => {
  let workspace: Workspace | undefined;
  let stubs: StubCommands | undefined;
  let outside: OutsideTarget | undefined;

  afterEach(async () => {
    await workspace?.dispose();
    await stubs?.dispose();
    await outside?.dispose();
    workspace = undefined;
    stubs = undefined;
    outside = undefined;
  });

  async function prepare(files: WorkspaceFiles, docker: StubRule[] = dockerRules()): Promise<Workspace> {
    workspace = await Workspace.create(files);
    stubs = await StubCommands.create({ docker });

    return workspace;
  }

  function scan(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome,
  ): Promise<ActionRunResult<ActionOutput>> {
    if (workspace === undefined || stubs === undefined) {
      throw new Error('prepare() first');
    }

    return runAction<ActionInput, ActionOutput>({
      actionDirectory: HELPER_DIRECTORY,
      inputs: { mode: 'scan', image: IMAGE, token: TOKEN, ...inputs },
      env: { PATH: stubs.pathPrepended() },
      secrets: [TOKEN],
      workspace,
      expect: expected,
    });
  }

  async function containerStarts(): Promise<number> {
    return (await stubs?.argumentsOf('docker'))?.length ?? 0;
  }

  describe('path inputs', () => {
    it.each(TRAVERSAL_PATHS)('refuses $name in inputs before the container starts', async ({ value }) => {
      await prepare({ '.github/workflows/ci.yml': WORKFLOW });

      const result = await scan({ inputs: value }, 'failure');

      expectCleanRejection(result, /inputs/);
      expect(await containerStarts()).toBe(0);
    });

    it.each(TRAVERSAL_PATHS)('refuses $name in config before the container starts', async ({ value }) => {
      await prepare({ '.github/workflows/ci.yml': WORKFLOW });

      const result = await scan({ config: value }, 'failure');

      expectCleanRejection(result, /config/);
      expect(await containerStarts()).toBe(0);
    });

    it.each(DECEPTIVE_PATHS.filter(({ value }) => !value.startsWith('-')))(
      'passes $name through as the ordinary relative path it is',
      async ({ value }) => {
        await prepare({ [value]: WORKFLOW });

        await scan({ inputs: value }, 'success');
        const [args = []] = (await stubs?.argumentsOf('docker')) ?? [];

        expect(args.at(-1)).toBe(value.replace('//', '/'));
      },
    );

    it('keeps a file named like a flag a path, written ./--output=x', async () => {
      await prepare({ '--output=x': WORKFLOW });

      await scan({ inputs: './--output=x' }, 'success');
      const [args = []] = (await stubs?.argumentsOf('docker')) ?? [];

      expect(args.slice(-2)).toEqual(['--', './--output=x']);
    });

    it('keeps a file named - a file, so zizmor never reads standard input', async () => {
      await prepare({ '-': WORKFLOW });

      await scan({ inputs: './-' }, 'success');
      const [args = []] = (await stubs?.argumentsOf('docker')) ?? [];

      expect(args.at(-1)).toBe('./-');
    });

    it('keeps a configuration file named like a flag a path', async () => {
      await prepare({ '.github/workflows/ci.yml': WORKFLOW, '-c.yml': 'rules: {}\n' });

      await scan({ config: '-c.yml' }, 'success');
      const [args = []] = (await stubs?.argumentsOf('docker')) ?? [];

      expect(args).toContain('--config=./-c.yml');
    });

    it('refuses an input that a committed link carries out of the workspace', async (context) => {
      if (!(await Workspace.symlinksSupported())) {
        context.skip();
      }

      await prepare({ '.github/workflows/ci.yml': WORKFLOW });
      outside = await linkOutside(workspace as Workspace, 'escape', `${BOM}name: outside\n`);

      const result = await scan({ inputs: 'escape' }, 'failure');

      expectCleanRejection(result, /symbolic link/);
      expect(await containerStarts()).toBe(0);
    });

    it('refuses a configuration file that a committed link carries out of the workspace', async (context) => {
      if (!(await Workspace.symlinksSupported())) {
        context.skip();
      }

      await prepare({ '.github/workflows/ci.yml': WORKFLOW });
      outside = await linkOutside(workspace as Workspace, 'zizmor.yml', 'rules: {}\n');

      const result = await scan({ config: 'zizmor.yml' }, 'failure');

      expectCleanRejection(result, /symbolic link/);
    });

    it('never follows a link inside a walked directory to read what it points at', async (context) => {
      if (!(await Workspace.symlinksSupported())) {
        context.skip();
      }

      await prepare({ '.github/workflows/ci.yml': WORKFLOW });
      // A directory outside holding a BOM'd action.yml, linked into the tree zizmor walks.
      outside = await linkOutside(workspace as Workspace, 'vendor', { 'action.yml': `${BOM}name: outside\n` });

      const result = await scan({}, 'success');

      expect(fileAnnotations(result, 'error')).toEqual([]);
    });
  });

  describe('hostile input values', () => {
    it.each(INPUT_HOSTILE_CHARACTERS)('handles a $name in inputs without injecting anything', async ({ value }) => {
      await prepare({ '.github/workflows/ci.yml': WORKFLOW });

      const result = await scan({ inputs: `.github${value}` }, 'any');

      expectNoCrash(result);
      expectNoInjection(result);
    });

    it.each(RUNNER_LINE_BREAKS)(
      'refuses a command payload split by $name in every free-text input',
      async ({ value }) => {
        const payload = commandInjectionPayload('.', value);

        for (const input of [
          'persona',
          'min_severity',
          'min_confidence',
          'fail_on_severity',
          'online_audits',
        ] as const) {
          await prepare({ '.github/workflows/ci.yml': WORKFLOW });

          const result = await scan({ [input]: payload }, 'failure');

          expectCleanRejection(result);
          expectNoInjection(result);
          expect(await containerStarts()).toBe(0);
          await workspace?.dispose();
          await stubs?.dispose();
        }

        workspace = undefined;
        stubs = undefined;
      },
    );

    it('treats every line of a payload in inputs as a path, refusing the missing ones', async () => {
      await prepare({ '.github/workflows/ci.yml': WORKFLOW });

      const result = await scan({ inputs: commandInjectionPayload('.') }, 'failure');

      expectCleanRejection(result, /inputs/);
      expectNoInjection(result);
    });

    it('never echoes the token, even inside a value it rejects', async () => {
      await prepare({ '.github/workflows/ci.yml': WORKFLOW });

      const result = await scan({ persona: TOKEN }, 'failure');

      expect(result.masks).toContain(TOKEN);
      expectSecretNotLeaked(result, TOKEN);
    });
  });

  describe('repository content', () => {
    it('escapes an annotation file property, so a comma in a name cannot add a property', async () => {
      await prepare({ '.github/workflows/a,line=99%0A.yml': `${BOM}${WORKFLOW}` });

      const result = await scan({}, 'failure');

      expect(fileAnnotations(result, 'error')).toEqual(['.github/workflows/a%2Cline=99%250A.yml']);
      expectNoInjection(result);
    });

    it('reads only the first three bytes of a huge candidate', async () => {
      await prepare({ '.github/workflows/huge.yml': `${BOM}${'#'.repeat(20 * 1024 * 1024)}\n` });

      const result = await scan({}, 'failure');

      expect(fileAnnotations(result, 'error')).toEqual(['.github/workflows/huge.yml']);
    });
  });

  describe("zizmor's log", () => {
    it.each(RUNNER_LINE_BREAKS)(
      'relays a log carrying commands split by $name without obeying them',
      async ({ value }) => {
        await prepare(
          { '.github/workflows/ci.yml': WORKFLOW },
          dockerRules({ exitCode: 1, stderr: commandInjectionPayload('failed to load file://./x.yml', value) }),
        );

        const result = await scan({}, 'failure');

        expectNoInjection(result);
        expect(result.stdout).toContain(`| ::error name=${FORGERY_MARKER}::${FORGERY_MARKER}-error`);
      },
    );

    it('does not trust a log that announces stop-commands', async () => {
      await prepare(
        { '.github/workflows/ci.yml': WORKFLOW },
        dockerRules({ stdout: sarif(), stderr: `::stop-commands::${FORGERY_MARKER}-token\n` }),
      );

      const result = await scan({}, 'success');

      // The step's own output still arrives as commands after the relayed line.
      expect(result.outputs['sarif_file']).toBeDefined();
      expectNoInjection(result);
    });
  });

  describe('SARIF content', () => {
    async function gate(contents: string, expected: ExpectedOutcome): Promise<ActionRunResult<ActionOutput>> {
      workspace = await Workspace.create();
      const sarifFile = join(workspace.path, 'results.sarif');

      await writeFile(sarifFile, contents, 'utf8');

      return runAction<ActionInput, ActionOutput>({
        actionDirectory: HELPER_DIRECTORY,
        inputs: { mode: 'gate', sarif_file: sarifFile },
        workspace,
        expect: expected,
      });
    }

    it.each(RUNNER_LINE_BREAKS)(
      'logs a rule, file and message carrying commands split by $name as data',
      async ({ value }) => {
        const payload = commandInjectionPayload('x', value);
        const hostile = JSON.stringify({
          version: '2.1.0',
          runs: [
            {
              results: [
                {
                  ruleId: payload,
                  message: { text: payload },
                  locations: [{ physicalLocation: { artifactLocation: { uri: payload }, region: { startLine: 1 } } }],
                  properties: { 'zizmor/severity': 'High' },
                },
              ],
            },
          ],
        });

        const result = await gate(hostile, 'failure');

        expectCleanRejection(result, /1 zizmor finding/);
        expectNoInjection(result);
      },
    );

    it('escapes markup in the job summary', async () => {
      const hostile = JSON.stringify({
        version: '2.1.0',
        runs: [
          {
            results: [
              {
                ruleId: '<script>alert(1)</script>',
                message: { text: '<img src=x onerror=alert(1)>' },
                locations: [{ physicalLocation: { artifactLocation: { uri: '"><svg onload=alert(1)>' } } }],
                properties: { 'zizmor/severity': 'Low' },
              },
            ],
          },
        ],
      });

      const result = await gate(hostile, 'failure');

      expect(result.stepSummary).not.toMatch(/<script|<img|<svg/);
      expect(result.stepSummary).toContain('&lt;script&gt;');
    });

    it.each([
      ['truncated JSON', sarif('High').slice(0, 40)],
      ['an empty file', ''],
      ['a JSON null', 'null'],
      ['a log with no runs', JSON.stringify({ version: '2.1.0', runs: [] })],
      ['a run without results', JSON.stringify({ version: '2.1.0', runs: [{}] })],
    ])('fails on %s instead of reading it as zero findings', async (_, contents) => {
      const result = await gate(contents, 'failure');

      expectCleanRejection(result, /SARIF|JSON/);
      expect(result.outputs).toEqual({});
    });
  });
});
