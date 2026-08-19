import { fileURLToPath } from 'node:url';

import { runAction, StubCommands, Workspace } from 'actions-e2e';
import { afterEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, ProvidedInputs, StubRule, WorkspaceFiles } from 'actions-e2e';

/**
 * End-to-end cases for `actions/rust/config-contract`.
 *
 * The action drives two executables neither a laptop nor the end-to-end job has: a Rust toolchain
 * and a Docker daemon. Both are supplied as stubs on `PATH`, which fakes exactly one thing — what
 * those tools *do* — and leaves everything else real: the shipped bundle, the `INPUT_*` decoding,
 * the `action.yaml` defaults, the process spawn, the argument vector, the exit codes, the files that
 * come back and the annotations that go out.
 *
 * That trade is what these cases are for. The composite this replaces could assert that a check
 * failed; it could not assert *which command was run*, and a generator invoked with the wrong
 * feature set produces a rendering that is internally consistent and describes the wrong types.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const IMAGE = 'myservice:test';
const CONTAINER = 'c'.repeat(64);
const EMBEDDED_PATH = '/config/contract.json';

const CONTRACT = ['{', '  "terrace_contract": 1,', '  "keys": ["server.port", "server.host"]', '}', ''].join('\n');

const LABELS = [
  'dev.terrace.config.contract.version=1',
  `dev.terrace.config.contract.path=${EMBEDDED_PATH}`,
  'dev.terrace.config.contract.digest=sha256:abc',
  '',
].join('\n');

const LABEL_BLOCK = [
  '# terrace-config:labels:begin',
  'LABEL dev.terrace.config.contract.version="1"',
  `LABEL dev.terrace.config.contract.path="${EMBEDDED_PATH}"`,
  'LABEL dev.terrace.config.contract.digest="sha256:abc"',
  '# terrace-config:labels:end',
  '',
].join('\n');

const DOCKERFILE = [
  'FROM rust:1 AS build',
  'RUN cargo build --release',
  '',
  LABEL_BLOCK,
  'ENTRYPOINT ["/app"]',
  '',
].join('\n');

const IMAGE_LABELS: Record<string, string> = {
  'dev.terrace.config.contract.version': '1',
  'dev.terrace.config.contract.path': EMBEDDED_PATH,
  'dev.terrace.config.contract.digest': 'sha256:abc',
  'org.opencontainers.image.title': 'myservice',
  'org.opencontainers.image.created': '2026-08-19T00:00:00Z',
};

/** The contract as it is embedded, which carries the build metadata the committed copy does not. */
const EMBEDDED_CONTRACT = JSON.stringify({ terrace_contract: 1, version: '1.4.0', revision: 'abc', created: 'now' });

interface Scene {
  /** Renderings the generator produces, keyed by `--format`. */
  renderings?: Partial<Record<'contract' | 'labels' | 'dockerfile', string>>;
  /** Exit code the generator fails with, for a case about a broken generator. */
  generatorExitCode?: number;
  generatorStderr?: string;
  /** What `docker inspect` answers with, verbatim. */
  inspectStdout?: string;
  /** Content `docker cp` produces. `null` is a path that holds nothing at all. */
  embedded?: string | null;
}

function cargoRules(scene: Scene): StubRule[] {
  if (scene.generatorExitCode !== undefined) {
    return [{ exitCode: scene.generatorExitCode, stderr: scene.generatorStderr ?? 'error: no example target' }];
  }

  const renderings = { contract: CONTRACT, labels: LABELS, dockerfile: LABEL_BLOCK, ...scene.renderings };

  return [
    { when: ['--format', 'contract'], stdout: renderings.contract },
    { when: ['--format', 'labels'], stdout: renderings.labels },
    { when: ['--format', 'dockerfile'], stdout: renderings.dockerfile },
  ];
}

function dockerRules(scene: Scene): StubRule[] {
  const embedded = scene.embedded === undefined ? EMBEDDED_CONTRACT : scene.embedded;
  const copy: StubRule =
    embedded === null
      ? { when: ['cp'], exitCode: 1, stderr: 'Error: No such container:path' }
      : { when: ['cp'], writeFinalArgument: embedded };

  return [
    { when: ['inspect'], stdout: `${scene.inspectStdout ?? JSON.stringify(IMAGE_LABELS)}\n` },
    { when: ['create'], stdout: `${CONTAINER}\n` },
    copy,
    { when: ['rm'], stdout: `${CONTAINER}\n` },
  ];
}

describe('config-contract', () => {
  let workspace: Workspace;
  let stubs: StubCommands;

  afterEach(async () => {
    await workspace.dispose();
    await stubs.dispose();
  });

  async function check(
    inputs: ProvidedInputs<ActionInput> = {},
    expected: ExpectedOutcome = 'success',
    scene: Scene = {},
    files: WorkspaceFiles = { Dockerfile: DOCKERFILE, 'docs/config.contract.json': CONTRACT },
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

  describe('a repository and an image that agree', () => {
    it('runs every check and publishes what it did', async () => {
      const result = await check();

      expect(result.errors).toEqual([]);
      expect(result.outputs['checks_run']).toBe('dockerfile-block committed-contract image-labels embedded-contract');
      expect(result.outputs['checks_skipped']).toBe('');
    });

    it('publishes the label set a push step would have to apply', async () => {
      const result = await check();

      expect(JSON.parse(result.outputs['labels'] ?? '{}')).toEqual({
        'dev.terrace.config.contract.version': '1',
        'dev.terrace.config.contract.path': EMBEDDED_PATH,
        'dev.terrace.config.contract.digest': 'sha256:abc',
      });
    });

    // Reproducible because `--format contract` is rendered without version, revision or timestamp,
    // which is the same property that lets the drift check be a diff rather than a comparison.
    it('publishes a checksum of the contract that does not move between runs', async () => {
      const first = await check();
      await workspace.dispose();
      await stubs.dispose();
      const second = await check();

      expect(first.outputs['contract_checksum']).toMatch(/^[0-9a-f]{64}$/);
      expect(second.outputs['contract_checksum']).toBe(first.outputs['contract_checksum']);
    });
  });

  describe('the generator invocation', () => {
    it('renders three formats from one run, in the source directory', async () => {
      await check();

      const invocations = await stubs.invocationsOf('cargo');

      expect(invocations).toHaveLength(3);
      expect(invocations.map((invocation) => invocation.args.at(-3))).toEqual(['contract', 'labels', 'dockerfile']);
      expect(invocations.every((invocation) => invocation.cwd === workspace.path)).toBe(true);
    });

    // The composite this replaces could not assert any of this. A generator run with the wrong
    // features produces a rendering that is internally consistent and describes the wrong types, so
    // every check passes and the contract is wrong.
    it('passes the package, features and contract path exactly as cargo expects them', async () => {
      await check({
        package: 'api-config',
        features: 'config-schema, cli',
        contract_path: '/etc/api/contract.json',
      });

      await expect(stubs.argumentsOf('cargo')).resolves.toContainEqual([
        'run',
        '--quiet',
        '--example',
        'config-schema',
        '-p',
        'api-config',
        '--features',
        'config-schema,cli',
        '--',
        '--format',
        'contract',
        '--path',
        '/etc/api/contract.json',
      ]);
    });

    it('omits -p and --features entirely when neither was asked for', async () => {
      await check();

      const [first] = await stubs.argumentsOf('cargo');

      expect(first).not.toContain('-p');
      expect(first).not.toContain('--features');
    });

    it('runs in the project directory when the crate is not at the repository root', async () => {
      await check(
        { source_directory: 'services/api', dockerfile: '', contract: '', image: '' },
        'success',
        {},
        { 'services/api/Cargo.toml': '[package]\nname = "api"\n' },
      );

      const [invocation] = await stubs.invocationsOf('cargo');

      expect(invocation.cwd.replaceAll('\\', '/')).toMatch(/services\/api$/);
    });

    // `@actions/exec` reports a working directory it cannot enter in terms of an absolute path,
    // which names the runner's layout rather than the input that was actually wrong.
    it('names the input when the source directory is not there, and runs nothing', async () => {
      const result = await check({ source_directory: 'services/api' }, 'failure', {}, {});

      expect(result.errors.join('\n')).toContain('source_directory');
      await expect(stubs.invocations()).resolves.toEqual([]);
    });

    it('fails without comparing anything when the generator fails', async () => {
      const result = await check({}, 'failure', { generatorExitCode: 101, generatorStderr: 'error: no example' });

      expect(result.errors.join('\n')).toContain('exited with 101');
      expect(result.errors.join('\n')).toContain('error: no example');
      await expect(stubs.invocationsOf('docker')).resolves.toEqual([]);
    });

    // A generator that wrote nothing would make every comparison trivially true, which is the one
    // failure this whole scheme cannot afford.
    it.each(['contract', 'labels', 'dockerfile'] as const)(
      'refuses a run whose %s rendering came out empty',
      async (format) => {
        const result = await check({}, 'failure', { renderings: { [format]: '' } });

        expect(result.errors.join('\n')).toContain(`--format ${format}\` produced nothing`);
        expect(result.outputs).toEqual({});
      },
    );
  });

  describe('the Dockerfile block', () => {
    // The case `grep -A2` passes: the committed block is a prefix of the generated one, so a
    // line-count comparison finds nothing wrong.
    it('catches a label missing from an otherwise identical block', async () => {
      const withoutDigest = DOCKERFILE.replace('LABEL dev.terrace.config.contract.digest="sha256:abc"\n', '');
      const result = await check(
        {},
        'failure',
        {},
        { Dockerfile: withoutDigest, 'docs/config.contract.json': CONTRACT },
      );

      expect(result.errors.join('\n')).toContain('- LABEL dev.terrace.config.contract.digest');
    });

    it('catches a renamed prefix', async () => {
      const renamed = DOCKERFILE.replaceAll('dev.terrace', 'dev.other');
      const result = await check({}, 'failure', {}, { Dockerfile: renamed, 'docs/config.contract.json': CONTRACT });

      expect(result.errors.join('\n')).toContain('terrace-config:labels region is not the block');
    });

    // An unrun check is not a passing image.
    it.each([
      { name: 'the Dockerfile is absent', content: undefined, expected: 'does not exist' },
      { name: 'the region is missing', content: 'FROM scratch\nLABEL a=1\n', expected: 'carries no' },
      {
        name: 'the region is empty',
        content: 'FROM scratch\n# terrace-config:labels:begin\n# terrace-config:labels:end\n',
        expected: 'nothing in it',
      },
    ])('refuses rather than skips when $name', async ({ content, expected }) => {
      const files: WorkspaceFiles =
        content === undefined
          ? { 'docs/config.contract.json': CONTRACT }
          : { Dockerfile: content, 'docs/config.contract.json': CONTRACT };
      const result = await check({}, 'failure', {}, files);

      expect(result.errors.join('\n')).toContain(expected);
    });

    it('skips only when the input is emptied, and says so', async () => {
      const result = await check({ dockerfile: '' }, 'success', {}, { 'docs/config.contract.json': CONTRACT });

      expect(result.outputs['checks_skipped']).toBe('dockerfile-block');
      expect(result.stdout).toContain('dockerfile-block');
    });
  });

  describe('the committed contract', () => {
    it('catches drift against what the types produce', async () => {
      const stale = CONTRACT.replace('"server.host"', '"server.hostname"');
      const result = await check({}, 'failure', {}, { Dockerfile: DOCKERFILE, 'docs/config.contract.json': stale });

      expect(result.errors.join('\n')).toContain('the committed contract is not the one these types produce');
      expect(result.errors.join('\n')).toContain('+   "keys": ["server.port", "server.hostname"]');
    });

    it('refuses an absent contract and says how to create one', async () => {
      const result = await check({}, 'failure', {}, { Dockerfile: DOCKERFILE });

      expect(result.errors.join('\n')).toMatch(/does not exist[\s\S]*commit the result/);
    });

    it('skips only when the input is emptied', async () => {
      const result = await check({ contract: '' }, 'success', {}, { Dockerfile: DOCKERFILE });

      expect(result.outputs['checks_skipped']).toBe('committed-contract');
    });
  });

  describe('the image', () => {
    it('asks docker for the config labels of the image it was given', async () => {
      await check();

      await expect(stubs.argumentsOf('docker')).resolves.toContainEqual([
        'inspect',
        '--format',
        '{{json .Config.Labels}}',
        IMAGE,
      ]);
    });

    it('ignores the labels every image carries anyway', async () => {
      const result = await check({}, 'success', {
        inspectStdout: JSON.stringify({ ...IMAGE_LABELS, 'com.example.built-by': 'ci' }),
      });

      expect(result.errors).toEqual([]);
    });

    it('catches a build argument that never interpolated', async () => {
      const labels = { ...IMAGE_LABELS, 'dev.terrace.config.contract.version': '${VERSION}' };
      const result = await check({}, 'failure', { inspectStdout: JSON.stringify(labels) });

      expect(result.errors.join('\n')).toContain('${VERSION}');
    });

    // A build that names one missing label and hides two is a second round trip through a pipeline
    // that already took minutes.
    it('reports all three missing labels at once', async () => {
      const result = await check({}, 'failure', { inspectStdout: '{}' });

      expect(result.errors.filter((message) => message.includes('carries no'))).toHaveLength(3);
    });

    // Go marshals a nil label map as `null`, which is what an image with no labels answers with.
    it('reads an image with no labels at all as three missing ones', async () => {
      const result = await check({}, 'failure', { inspectStdout: 'null' });

      expect(result.errors.filter((message) => message.includes('carries no'))).toHaveLength(3);
    });

    it('creates a container, copies the contract out and removes the container', async () => {
      await check();

      const docker = await stubs.argumentsOf('docker');

      expect(docker).toContainEqual(['create', IMAGE]);
      expect(docker.find((args) => args[0] === 'cp')?.[1]).toBe(`${CONTAINER}:${EMBEDDED_PATH}`);
      expect(docker).toContainEqual(['rm', '--force', CONTAINER]);
    });

    it('reports nothing being where the label says the contract is', async () => {
      const result = await check({}, 'failure', { embedded: null });

      expect(result.errors.join('\n')).toContain('dev.terrace.config.contract.path');
      expect(result.errors.join('\n')).toContain('not self-describing');
    });

    it('removes the container even when the copy found nothing', async () => {
      await check({}, 'failure', { embedded: null });

      await expect(stubs.argumentsOf('docker')).resolves.toContainEqual(['rm', '--force', CONTAINER]);
    });

    it('reports a file at the path that is not a contract', async () => {
      const result = await check({}, 'failure', { embedded: '<html>404</html>' });

      expect(result.errors.join('\n')).toContain('is not a terrace-config contract');
    });

    // The embedded copy carries the version, revision and timestamp of the build that made it, so
    // it is deliberately not compared against the byte-reproducible one.
    it('accepts an embedded copy that carries build metadata', async () => {
      const result = await check({}, 'success', { embedded: EMBEDDED_CONTRACT });

      expect(result.errors).toEqual([]);
    });

    it('skips both image checks when no image is given, and never calls docker', async () => {
      const result = await check({ image: '' });

      expect(result.outputs['checks_skipped']).toBe('image-labels embedded-contract');
      expect(result.outputs['checks_run']).toBe('dockerfile-block committed-contract');
      await expect(stubs.invocationsOf('docker')).resolves.toEqual([]);
    });
  });

  // A run that fails on the Dockerfile and never looks at the image is a second round trip through
  // a pipeline that already took minutes.
  it('runs every check and reports every fault before failing once', async () => {
    const result = await check({}, 'failure', { inspectStdout: '{}', embedded: 'not a contract' }, {});

    expect(result.outputs['checks_run']).toBe('dockerfile-block committed-contract image-labels embedded-contract');
    expect(result.errors.length).toBeGreaterThanOrEqual(6);
    expect(result.errors.at(-1)).toContain('contract checks failed');
  });

  it('publishes its outputs even on the run that failed, so a summary step can read them', async () => {
    const result = await check({}, 'failure', { inspectStdout: '{}' });

    expect(result.outputs['contract_checksum']).toMatch(/^[0-9a-f]{64}$/);
    expect(result.outputs['checks_run']).toContain('image-labels');
  });
});
