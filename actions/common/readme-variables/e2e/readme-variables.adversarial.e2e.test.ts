import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  DECEPTIVE_PATHS,
  expectCleanRejection,
  expectNoCrash,
  expectNoFileCommandForgery,
  expectNoInjection,
  expectSecretNotLeaked,
  fileCommandInjectionPayload,
  INPUT_HOSTILE_CHARACTERS,
  LARGEST_DELIVERABLE_INPUT,
  linkOutside,
  OUTSIDE_SECRET,
  oversized,
  runAction,
  RUNNER_LINE_BREAKS,
  TRAVERSAL_PATHS,
  Workspace,
  yamlAliasBomb,
} from 'actions-e2e';
import { afterEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ActionRunResult, ExpectedOutcome, OutsideTarget, ProvidedInputs, WorkspaceFiles } from 'actions-e2e';

/**
 * Hostile cases for `actions/common/readme-variables`.
 *
 * The action reads the checkout — a manifest, a docs tree — and publishes what it found as a JSON
 * payload that `render-template` then writes into a README, which a later step commits. Everything
 * it reads can come from a pull request, so the questions are the usual three: can that content
 * leave the checkout (a manifest or docs directory committed as a link to the runner's disk), can it
 * become a command (a version string carrying `::error::`), and can `extra` reach the prototype of
 * the payload the template is rendered against.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const SYMLINKS = await Workspace.symlinksSupported();

const PACKAGE_JSON = JSON.stringify({ name: 'fixture', version: '1.4.0' });

/** A manifest that parses, so a case that reaches it is refused for where it is, not what it holds. */
const OUTSIDE_PACKAGE_JSON = JSON.stringify({ name: 'outside', version: '9.9.9', description: OUTSIDE_SECRET });

describe('readme-variables under hostile input', () => {
  let workspace: Workspace;

  afterEach(async () => {
    await workspace.dispose();
  });

  async function withFiles(files: WorkspaceFiles): Promise<void> {
    workspace = await Workspace.create(files);
  }

  function collect(
    inputs: ProvidedInputs<ActionInput> = {},
    expected: ExpectedOutcome = 'success',
  ): Promise<ActionRunResult<ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { repository: 'owner/name', branch: 'main', ...inputs },
      workspace,
      expect: expected,
    });
  }

  describe('path containment', () => {
    it.each(TRAVERSAL_PATHS)('refuses a manifest at $name', async ({ value }) => {
      await withFiles({ 'package.json': PACKAGE_JSON });

      const result = await collect({ manifest: value }, 'failure');

      expectCleanRejection(result, /manifest (must|resolves)/);
      expect(result.outputs).toEqual({});
    });

    it.each(TRAVERSAL_PATHS)('refuses a docs directory at $name', async ({ value }) => {
      await withFiles({ 'package.json': PACKAGE_JSON });

      const result = await collect({ 'docs-dir': value }, 'failure');

      expectCleanRejection(result, /docs-dir (must|resolves)/);
      expect(result.outputs).toEqual({});
    });

    // The mirror image: a name that only resembles an escape is an ordinary, absent directory, and an
    // absent docs directory is documented as an empty index rather than an error.
    it.each(DECEPTIVE_PATHS)('reads $name as an ordinary docs directory', async ({ value }) => {
      await withFiles({ 'package.json': PACKAGE_JSON });

      const result = await collect({ 'docs-dir': value });

      expect(JSON.parse(result.outputs['variables'] as string)).toHaveProperty('docs', []);
    });
  });

  describe.runIf(SYMLINKS)('symbolic links that leave the workspace', () => {
    let outside: OutsideTarget | undefined;

    afterEach(async () => {
      await outside?.dispose();
      outside = undefined;
    });

    it('refuses a named manifest that links outside, and publishes nothing it holds', async () => {
      await withFiles({});
      outside = await linkOutside(workspace, 'package.json', OUTSIDE_PACKAGE_JSON);

      const result = await collect({ manifest: 'package.json' }, 'failure');

      expectCleanRejection(result, /manifest resolves outside the workspace through a symbolic link/);
      expectSecretNotLeaked(result, OUTSIDE_SECRET);
    });

    // Detection checks only that a candidate exists, and a link to an existing file does.
    it('refuses a detected manifest that links outside', async () => {
      await withFiles({});
      outside = await linkOutside(workspace, 'package.json', OUTSIDE_PACKAGE_JSON);

      const result = await collect({}, 'failure');

      expectCleanRejection(result, /manifest resolves outside the workspace through a symbolic link/);
      expectSecretNotLeaked(result, OUTSIDE_SECRET);
    });

    it('refuses a docs directory that links outside, and indexes nothing beneath it', async () => {
      await withFiles({ 'package.json': PACKAGE_JSON });
      outside = await linkOutside(workspace, 'docs', { 'LEAK.md': `# Leak\n\n${OUTSIDE_SECRET}\n` });

      const result = await collect({}, 'failure');

      expectCleanRejection(result, /docs-dir resolves outside the workspace through a symbolic link/);
      expectSecretNotLeaked(result, OUTSIDE_SECRET);
    });

    // The walk reads directory entries without following them, so a link inside the docs tree is
    // neither a file nor a directory to it. Asserted because a refactor onto `stat` would change that.
    it('skips a document that links outside, rather than summarising what it points at', async () => {
      await withFiles({ 'package.json': PACKAGE_JSON, 'docs/REAL.md': '# Real\n\nInside.\n' });
      outside = await linkOutside(workspace, 'docs/LEAK.md', `# Leak\n\n${OUTSIDE_SECRET}\n`);

      const result = await collect();
      const docs = (JSON.parse(result.outputs['variables'] as string) as { docs: Array<{ path: string }> }).docs;

      expect(docs.map((entry) => entry.path)).toEqual(['docs/REAL.md']);
      expectSecretNotLeaked(result, OUTSIDE_SECRET);
    });
  });

  describe('the extra payload', () => {
    // `constructor.constructor` is the classic Handlebars sandbox escape, and this payload is what
    // render-template renders against.
    it.each([
      ['__proto__ at the top', '{"__proto__":{"polluted":true}}', '__proto__'],
      ['constructor nested in an array', '{"a":[{"constructor":{"prototype":{}}}]}', 'constructor'],
      ['prototype deep in an object', '{"a":{"b":{"prototype":1}}}', 'prototype'],
    ])('refuses %s', async (_name, extra, key) => {
      await withFiles({ 'package.json': PACKAGE_JSON });

      const result = await collect({ extra }, 'failure');

      expectCleanRejection(result, new RegExp(`key '${key}' at .* is not allowed`));
      expect(result.outputs).toEqual({});
    });

    it.each([
      ['just past the nesting limit', 65],
      ['nested far deeper than any stack', 20_000],
    ])('refuses a value %s, by depth rather than by crashing', async (_name, depth) => {
      await withFiles({ 'package.json': PACKAGE_JSON });

      const result = await collect({ extra: `{"a":${'['.repeat(depth)}${']'.repeat(depth)}}` }, 'failure');

      expectCleanRejection(result, /exceeds the maximum depth/);
    });

    it.each([
      ['not JSON', '{a: 1}', /not valid JSON/],
      ['a JSON array', '[1,2]', /not a JSON object/],
      ['a JSON string', '"text"', /not a JSON object/],
    ])('refuses an extra that is %s', async (_name, extra, reason) => {
      await withFiles({ 'package.json': PACKAGE_JSON });

      expectCleanRejection(await collect({ extra }, 'failure'), reason);
    });

    it('carries the largest extra a workflow can deliver', async () => {
      await withFiles({ 'package.json': PACKAGE_JSON });

      const payload = oversized(LARGEST_DELIVERABLE_INPUT - 32);
      const result = await collect({ extra: JSON.stringify({ blob: payload }) });

      expect(JSON.parse(result.outputs['variables'] as string)).toHaveProperty('blob', payload);
    });
  });

  describe('workflow command injection', () => {
    it('publishes a manifest version full of workflow commands as data, and none take effect', async () => {
      await withFiles({
        'package.json': JSON.stringify({ name: 'x', version: commandInjectionPayload('1.0.0') }),
      });

      const result = await collect();

      expect(result.outputs['version']).toBe(commandInjectionPayload('1.0.0'));
      expectNoInjection(result);
    });

    it('publishes four outputs however the version is shaped', async () => {
      await withFiles({ 'package.json': JSON.stringify({ name: 'x', version: fileCommandInjectionPayload() }) });

      const result = await collect();

      expect(Object.keys(result.outputs).toSorted()).toEqual(['manifest-path', 'tag', 'variables', 'version']);
      expectNoFileCommandForgery(result);
    });

    it('forges nothing through the title and summary of a document', async () => {
      await withFiles({
        'package.json': PACKAGE_JSON,
        'docs/EVIL.md': `# ${commandInjectionPayload('Title')}\n\n${commandInjectionPayload('Summary')}\n`,
      });

      expectNoInjection(await collect());
    });

    it.each(RUNNER_LINE_BREAKS)(
      'forges nothing through a manifest path whose lines end in $name',
      async ({ value }) => {
        await withFiles({ 'package.json': PACKAGE_JSON });

        const result = await collect({ manifest: commandInjectionPayload('package.json', value) }, 'failure');

        expectCleanRejection(result);
        expectNoInjection(result);
      },
    );

    it.each([
      ['repository', 'repository'],
      ['branch', 'branch'],
      ['tag-prefix', 'tag-prefix'],
      ['docs-dir', 'docs-dir'],
    ] as const)('forges nothing through %s', async (_name, input) => {
      await withFiles({ 'package.json': PACKAGE_JSON });

      const result = await collect({ [input]: commandInjectionPayload('value') }, 'any');

      expectNoCrash(result);
      expectNoInjection(result);
    });

    // Mid-value, because `getInput` trims and CR, LF and U+2028 are whitespace to `String.trim`.
    it.each(INPUT_HOSTILE_CHARACTERS)('carries $name ($risk) in the tag prefix as data', async ({ value }) => {
      await withFiles({ 'package.json': PACKAGE_JSON });

      const result = await collect({ 'tag-prefix': `v${value}-` });

      expect(result.outputs['tag']).toBe(`v${value}-1.4.0`);
      expectNoInjection(result);
    });
  });

  describe('abusive manifests', () => {
    it('refuses a Chart.yaml alias bomb instead of expanding it', async () => {
      await withFiles({ 'Chart.yaml': `${yamlAliasBomb()}version: 1.0.0\n` });

      const result = await collect({}, 'failure');

      expectCleanRejection(result, /Chart\.yaml: not valid YAML/);
    });

    it.each([
      ['package.json', '{"version": '],
      ['Chart.yaml', 'version: [unclosed\n'],
      ['Cargo.toml', '[package\nversion = "1"\n'],
    ])('fails legibly on a malformed %s', async (file, contents) => {
      await withFiles({ [file]: contents });

      const result = await collect({}, 'any');

      if (result.exitCode !== 0) {
        expectCleanRejection(result, new RegExp(file.replace('.', '\\.')));
      }

      expectNoCrash(result);
    });

    it('refuses a manifest whose basename names no reader, before opening it', async () => {
      await withFiles({ 'secrets.env': `TOKEN=${OUTSIDE_SECRET}\n` });

      const result = await collect({ manifest: 'secrets.env' }, 'failure');

      expectCleanRejection(result, /secrets\.env: manifest not found or not readable/);
      expectSecretNotLeaked(result, OUTSIDE_SECRET);
    });
  });
});
