import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  DECEPTIVE_PATHS,
  expectCleanRejection,
  expectNoInjection,
  fileCommandInjectionPayload,
  INPUT_HOSTILE_CHARACTERS,
  LARGEST_DELIVERABLE_INPUT,
  oversized,
  runAction,
  StubCommands,
  TRAVERSAL_PATHS,
  Workspace,
} from 'actions-e2e';
import { afterEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs, StubRule, WorkspaceFiles } from 'actions-e2e';

/**
 * Hostile cases for `actions/rust/config-contract`.
 *
 * This action has two attack surfaces a purely file-reading one does not. Four of its inputs become
 * arguments to `cargo` or `docker`, so a value that escapes its grammar is a command the workflow
 * never wrote; and everything it reports on is *generated* — the renderings come out of a build of
 * the repository under test, which on a `pull_request` run is code the pull request author wrote.
 * A contract, a label value or a Dockerfile line carrying `::stop-commands::` is therefore the
 * ordinary case, not an exotic one.
 *
 * The stubs make the first surface assertable: a payload that survived validation would appear in
 * the recorded argument vector, and a run that reached the tools at all when it should have been
 * refused shows up as an invocation that should not exist.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const IMAGE = 'myservice:test';
const CONTAINER = 'd'.repeat(64);
const EMBEDDED_PATH = '/config/contract.json';

const CONTRACT = '{\n  "terrace_contract": 1,\n  "keys": []\n}\n';

const LABEL_BLOCK = [
  '# terrace-config:labels:begin',
  'LABEL dev.terrace.config.contract.version="1"',
  '# terrace-config:labels:end',
  '',
].join('\n');

const LABELS = 'dev.terrace.config.contract.version=1\n';

const DOCKERFILE = `FROM scratch\n${LABEL_BLOCK}`;

const FILES: WorkspaceFiles = { Dockerfile: DOCKERFILE, 'docs/config.contract.json': CONTRACT };

interface Scene {
  contract?: string;
  labels?: string;
  dockerfile?: string;
  imageLabels?: string;
  embedded?: string;
}

function cargoRules(scene: Scene): StubRule[] {
  return [
    { when: ['--format', 'contract'], stdout: scene.contract ?? CONTRACT },
    { when: ['--format', 'labels'], stdout: scene.labels ?? LABELS },
    { when: ['--format', 'dockerfile'], stdout: scene.dockerfile ?? LABEL_BLOCK },
  ];
}

function dockerRules(scene: Scene): StubRule[] {
  return [
    {
      when: ['inspect'],
      stdout: `${scene.imageLabels ?? JSON.stringify({ 'dev.terrace.config.contract.version': '1' })}\n`,
    },
    { when: ['create'], stdout: `${CONTAINER}\n` },
    { when: ['cp'], writeFinalArgument: scene.embedded ?? CONTRACT },
    { when: ['rm'], stdout: `${CONTAINER}\n` },
  ];
}

describe('config-contract under hostile input', () => {
  let workspace: Workspace;
  let stubs: StubCommands;

  afterEach(async () => {
    await workspace.dispose();
    await stubs.dispose();
  });

  async function check(
    inputs: ProvidedInputs<ActionInput> = {},
    expected: ExpectedOutcome = 'any',
    scene: Scene = {},
    files: WorkspaceFiles = FILES,
  ): Promise<ActionRunResult<ActionOutput>> {
    workspace = await Workspace.create(files);
    stubs = await StubCommands.create({ cargo: cargoRules(scene), docker: dockerRules(scene) });

    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { image: IMAGE, ...inputs },
      env: { PATH: stubs.pathPrepended() },
      workspace,
      expect: expected,
    });
  }

  /** Every argument any stub was handed, flattened, for asserting a payload never reached one. */
  async function everyArgument(): Promise<string[]> {
    return (await stubs.invocations()).flatMap((invocation) => invocation.args);
  }

  describe('inputs that become arguments to cargo', () => {
    it.each(['example', 'package', 'features'] as const)('refuses a workflow command payload in %s', async (input) => {
      const result = await check({ [input]: commandInjectionPayload() }, 'failure');

      expectCleanRejection(result, new RegExp(input));
      expectNoInjection(result);
      await expect(stubs.invocations()).resolves.toEqual([]);
    });

    it.each([
      { name: 'a cargo flag', value: '--manifest-path=/etc/passwd' },
      { name: 'a nightly flag', value: '-Zunstable-options' },
      { name: 'a second argument smuggled in by a space', value: 'config-schema --offline' },
      { name: 'a shell metacharacter', value: 'config-schema;id' },
      { name: 'a command substitution', value: 'config-schema$(id)' },
      { name: 'a backtick substitution', value: 'config-schema`id`' },
    ])('refuses $name in example, and runs nothing at all', async ({ value }) => {
      const result = await check({ example: value }, 'failure');

      expectCleanRejection(result, /example/);
      await expect(stubs.invocations()).resolves.toEqual([]);
    });

    // The interesting half of the feature list: it is the one input whose whitespace is a separator,
    // so a value that got through would be a second argument rather than a longer feature name.
    it.each([
      { name: 'a flag', value: 'config-schema,--offline' },
      { name: 'a path', value: 'config-schema,../../etc' },
      { name: 'a quote', value: 'config-schema,"' },
    ])('refuses $name in features', async ({ value }) => {
      expectCleanRejection(await check({ features: value }, 'failure'), /features/);
    });

    it.each(INPUT_HOSTILE_CHARACTERS)('refuses $name in example, whose risk is that it $risk', async ({ value }) => {
      const result = await check({ example: `config${value}schema` }, 'failure');

      expectCleanRejection(result);
      expectNoInjection(result);
    });

    it('refuses an oversized example rather than assembling a command line out of it', async () => {
      const result = await check({ example: oversized(LARGEST_DELIVERABLE_INPUT) }, 'failure');

      expectCleanRejection(result, /example/);
      await expect(stubs.invocations()).resolves.toEqual([]);
    });
  });

  describe('the image reference, which becomes an argument to docker', () => {
    it.each([
      { name: 'a docker flag', value: '--privileged' },
      { name: 'a short flag', value: '-v' },
      { name: 'a second argument smuggled in by a space', value: 'api --rm' },
      { name: 'a workflow command payload', value: commandInjectionPayload() },
      { name: 'a shell metacharacter', value: 'api;id' },
      { name: 'a newline', value: 'api\nlatest' },
      { name: 'an oversized reference', value: oversized(600) },
    ])('refuses $name and never reaches docker', async ({ value }) => {
      const result = await check({ image: value }, 'failure');

      expectCleanRejection(result, /image/);
      expectNoInjection(result);
      await expect(stubs.invocationsOf('docker')).resolves.toEqual([]);
    });

    it.each([
      { name: 'a traversal', value: '/config/../../etc/passwd' },
      { name: 'a relative path', value: 'config/contract.json' },
      { name: 'a workflow command payload', value: commandInjectionPayload() },
      { name: 'an empty path', value: '' },
    ])('refuses $name in contract_path', async ({ value }) => {
      const result = await check({ contract_path: value }, 'failure');

      expectCleanRejection(result, /contract_path/);
      await expect(everyArgument()).resolves.not.toContain(value);
    });
  });

  describe('path containment', () => {
    it.each(TRAVERSAL_PATHS)('refuses $name in source_directory, and runs nothing', async ({ value }) => {
      const result = await check({ source_directory: value }, 'failure');

      expectCleanRejection(result, /source_directory/);
      expectNoInjection(result);
      await expect(stubs.invocations()).resolves.toEqual([]);
    });

    it.each(TRAVERSAL_PATHS)('refuses $name in dockerfile', async ({ value }) => {
      expectCleanRejection(await check({ dockerfile: value }, 'failure'), /dockerfile/);
    });

    it.each(TRAVERSAL_PATHS)('refuses $name in contract', async ({ value }) => {
      expectCleanRejection(await check({ contract: value }, 'failure'), /contract/);
    });

    // Node performs no percent-decoding and no tilde expansion, so these are ordinary relative
    // names. Contained, therefore simply absent — a repository may legitimately hold a file named
    // `~`, and reporting one of these as an escape would be reading it the way a shell does.
    it.each(DECEPTIVE_PATHS)('reports $name as a Dockerfile it cannot find, not as an escape', async ({ value }) => {
      const result = await check({ dockerfile: value, contract: '', image: '' }, 'failure');

      expect(result.errors.join('\n')).toContain('does not exist');
      expectNoInjection(result);
    });

    it('writes nothing anywhere when an input is refused', async () => {
      await check({ dockerfile: '../../escaped' }, 'failure');

      await expect(workspace.entries()).resolves.toEqual(['Dockerfile', 'docs/config.contract.json']);
    });

    // The workspace is where a rejected run must leave no trace; the embedded copy lands in
    // RUNNER_TEMP, which is the step's own scratch and is removed with it.
    it('never writes the copied contract into the checkout', async () => {
      await check({}, 'success');

      await expect(workspace.entries()).resolves.toEqual(['Dockerfile', 'docs/config.contract.json']);
    });
  });

  describe('generated output, which is built from the repository under test', () => {
    // The renderings come out of a build of the code being checked. On a `pull_request` run that is
    // content the pull request author wrote, and it reaches the log through every annotation.
    it('does not let a contract forge a workflow command', async () => {
      const hostile = `${commandInjectionPayload()}\n`;
      const result = await check({ image: '' }, 'failure', { contract: hostile });

      expectNoInjection(result);
      expect(result.errors.join('\n')).toContain('the committed contract is not the one these types produce');
    });

    it('does not let a Dockerfile block forge a workflow command', async () => {
      const hostile = [
        '# terrace-config:labels:begin',
        commandInjectionPayload(),
        '# terrace-config:labels:end',
        '',
      ].join('\n');

      expectNoInjection(await check({ contract: '', image: '' }, 'failure', { dockerfile: hostile }));
    });

    it('does not let a committed Dockerfile forge a workflow command', async () => {
      const hostile = [
        'FROM scratch',
        '# terrace-config:labels:begin',
        commandInjectionPayload(),
        '# terrace-config:labels:end',
        '',
      ].join('\n');

      expectNoInjection(await check({ contract: '', image: '' }, 'failure', {}, { Dockerfile: hostile }));
    });

    it('does not let an image label value forge a workflow command', async () => {
      const labels = JSON.stringify({ 'dev.terrace.config.contract.version': commandInjectionPayload() });

      expectNoInjection(await check({ dockerfile: '', contract: '' }, 'failure', { imageLabels: labels }));
    });

    it('does not let a label value forge a second output', async () => {
      const result = await check({ dockerfile: '', contract: '', image: '' }, 'any', {
        labels: `dev.terrace.config.contract.version=${fileCommandInjectionPayload().replaceAll('\n', ' ')}\n`,
      });

      expectNoInjection(result);
    });

    // A label name is a JSON object key in the `labels` output. A name that is not a name has to be
    // refused before it becomes one, or the output stops being a document the caller can parse.
    it('refuses a labels rendering that is not a set of labels', async () => {
      const result = await check({}, 'failure', { labels: `${commandInjectionPayload()}\n` });

      expectCleanRejection(result, /--format labels/);
      expectNoInjection(result);
    });

    it('refuses an image whose label set is not an object', async () => {
      const result = await check({ dockerfile: '', contract: '' }, 'failure', { imageLabels: '"a string"' });

      expectCleanRejection(result, /not an object/);
    });

    it('refuses an image whose inspect output is not JSON at all', async () => {
      const result = await check({ dockerfile: '', contract: '' }, 'failure', { imageLabels: '<template error>' });

      expectCleanRejection(result, /did not answer with JSON/);
    });

    it('reports an embedded document that is not a contract without echoing it', async () => {
      const result = await check({ dockerfile: '', contract: '' }, 'failure', {
        embedded: commandInjectionPayload(),
      });

      expect(result.errors.join('\n')).toContain('is not a terrace-config contract');
      expectNoInjection(result);
    });

    it('bounds a single enormous generated line rather than flooding the log', async () => {
      const result = await check({ image: '' }, 'failure', { contract: `${oversized(200_000)}\n` });

      expectCleanRejection(result);
      expect(result.errors.join('\n').length).toBeLessThan(10_000);
    });
  });

  describe('files in the checkout', () => {
    it('reads through a symbolic link without following it into a command', async () => {
      if (!(await Workspace.symlinksSupported())) {
        return;
      }

      workspace = await Workspace.create({ 'real.dockerfile': `FROM scratch\n${commandInjectionPayload()}\n` });
      await workspace.symlink('Dockerfile', 'real.dockerfile');
      stubs = await StubCommands.create({ cargo: cargoRules({}), docker: dockerRules({}) });

      const result = await runAction<ActionInput, ActionOutput>({
        actionDirectory: ACTION_DIRECTORY,
        inputs: { contract: '', image: '' },
        env: { PATH: stubs.pathPrepended() },
        workspace,
        expect: 'failure',
      });

      expectCleanRejection(result);
      expectNoInjection(result);
    });

    it('refuses a Dockerfile whose marked region appears twice, rather than picking one', async () => {
      const doubled = `FROM scratch\n${LABEL_BLOCK}${LABEL_BLOCK}`;
      const result = await check({ contract: '', image: '' }, 'failure', {}, { Dockerfile: doubled });

      expect(result.errors.join('\n')).toContain('more than one marked region');
    });

    it('reports a directory where a contract should be as a file it cannot read', async () => {
      const result = await check(
        { dockerfile: '', image: '', contract: 'docs' },
        'failure',
        {},
        { 'docs/keep.txt': 'x' },
      );

      expectCleanRejection(result);
    });
  });
});
