import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  DECEPTIVE_PATHS,
  expectCleanRejection,
  expectNoInjection,
  oversized,
  runAction,
  TRAVERSAL_PATHS,
  Workspace,
} from 'actions-e2e';
import { afterEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ExpectedOutcome, ProvidedInputs } from 'actions-e2e';

/**
 * Hostile cases for `actions/common/render-template`.
 *
 * The action's dangerous capability is that it *writes a file at a caller-supplied path*. Until the
 * containment check went in, `output: ../escaped.md` wrote outside the checkout without a word in the
 * log — on a runner that is an arbitrary write next to the job's other repositories, its git config
 * and whatever else the workspace root sits beside. These cases hold that door shut, and prove the
 * two template engines' escapes (a partial reaching out of its directory, a template reaching
 * `constructor`) stay shut with it.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const TEMPLATE = 'README.hbs';
const OUTPUT = 'out/README.md';

describe('render-template under hostile input', () => {
  let workspace: Workspace;

  afterEach(async () => {
    await workspace.dispose();
  });

  function render(
    inputs: ProvidedInputs<ActionInput>,
    expected: ExpectedOutcome = 'success',
  ): ReturnType<typeof runAction<ActionInput, ActionOutput>> {
    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { template: TEMPLATE, output: OUTPUT, variables: '{}', ...inputs },
      workspace,
      expect: expected,
    });
  }

  describe('path containment', () => {
    it.each(TRAVERSAL_PATHS)('refuses to write to $name', async ({ value }) => {
      workspace = await Workspace.create({ [TEMPLATE]: 'rendered\n' });

      const result = await render({ output: value }, 'failure');

      expectCleanRejection(result, /output (must|resolves)/);
      await expect(workspace.entries(), 'nothing may be written anywhere').resolves.toEqual([TEMPLATE]);
    });

    it.each(TRAVERSAL_PATHS)('refuses to read a template at $name', async ({ value }) => {
      workspace = await Workspace.create({ [TEMPLATE]: 'rendered\n' });

      const result = await render({ template: value }, 'failure');

      expectCleanRejection(result, /template (must|resolves)/);
      await expect(workspace.entries()).resolves.toEqual([TEMPLATE]);
    });

    it.each(TRAVERSAL_PATHS)('refuses to load partials from $name', async ({ value }) => {
      workspace = await Workspace.create({ [TEMPLATE]: 'rendered\n' });

      const result = await render({ 'partials-dir': value }, 'failure');

      expectCleanRejection(result, /partials-dir (must|resolves)/);
    });

    // The case the containment check exists for, asserted against the file system rather than the
    // exit code: a run that "failed" but still wrote the file would pass every other test here.
    it('leaves the directory beside the workspace untouched', async () => {
      const sibling = await mkdtemp(path.join(tmpdir(), 'actions-e2e-outside-'));

      workspace = await Workspace.create({ [TEMPLATE]: 'escaped\n' });

      // Narrowed to the one name the payloads would create, not to "nothing new appeared": the parent
      // of a scratch workspace is the shared temp directory, and other suites are creating their own
      // workspaces there in parallel while this case runs.
      const parent = path.dirname(workspace.path);
      const escapee = 'escaped.md';
      const existedBefore = (await readdir(parent)).includes(escapee);

      try {
        const absolute = path.join(sibling, escapee).replaceAll('\\', '/');

        await render({ output: `../${escapee}` }, 'failure');
        await render({ output: absolute }, 'failure');
        await render({ output: `a/../../${escapee}` }, 'failure');

        await expect(readdir(sibling), 'no file may appear in a sibling directory').resolves.toEqual([]);
        expect((await readdir(parent)).includes(escapee), 'no file may appear beside the workspace').toBe(
          existedBefore,
        );
      } finally {
        await rm(sibling, { recursive: true, force: true });
      }
    });

    // The mirror image of the cases above: a path that only resembles an escape is a legitimate file
    // name, and rejecting it would be a bug of its own.
    it.each(DECEPTIVE_PATHS)('treats $name as an ordinary name inside the workspace', async ({ value }) => {
      workspace = await Workspace.create({ [TEMPLATE]: 'rendered\n' });

      const result = await render({ output: value });

      expect(result.outputs['output-path']).toBe(value);
      await expect(workspace.read(value)).resolves.toBe('rendered\n');
      // Whatever it created, it created beneath the workspace — which is all containment asks.
      await expect(workspace.entries()).resolves.toContain(value.split('\\').join('/').replaceAll('//', '/'));
    });

    it('still accepts an ordinary nested output path', async () => {
      workspace = await Workspace.create({ [TEMPLATE]: 'rendered\n' });

      const result = await render({ output: 'docs/generated/deep/README.md' });

      expect(result.outputs['output-path'], 'the path is reported as the caller wrote it').toBe(
        'docs/generated/deep/README.md',
      );
      await expect(workspace.read('docs/generated/deep/README.md')).resolves.toBe('rendered\n');
    });

    it('refuses an escaping path in check mode too, before reading anything', async () => {
      workspace = await Workspace.create({ [TEMPLATE]: 'rendered\n' });

      const result = await render({ output: '../escaped.md', check: 'true' }, 'failure');

      expectCleanRejection(result, /output must not traverse upwards/);
    });
  });

  describe('workflow command injection', () => {
    it('renders a template full of workflow commands into the file and not into the log', async () => {
      const payload = commandInjectionPayload();

      workspace = await Workspace.create({ [TEMPLATE]: `${payload}\n` });

      const result = await render({});

      await expect(workspace.read(OUTPUT), 'the content is written verbatim, as it should be').resolves.toBe(
        `${payload}\n`,
      );
      expectNoInjection(result);
    });

    it('forges nothing through a variable interpolated into the output', async () => {
      workspace = await Workspace.create({ [TEMPLATE]: '{{ body }}\n' });

      const result = await render({ variables: JSON.stringify({ body: commandInjectionPayload() }) });

      expectNoInjection(result);
    });

    it('forges nothing through the paths it names in a failure', async () => {
      workspace = await Workspace.create({});

      const result = await render({ template: commandInjectionPayload('absent.hbs') }, 'failure');

      expectCleanRejection(result);
      expectNoInjection(result);
    });
  });

  describe('template engine escapes', () => {
    it.each([
      { name: 'the constructor of a value', template: '{{ repo.constructor.constructor }}' },
      { name: 'a prototype walk', template: '{{ repo.__proto__.polluted }}' },
      { name: 'lookup with a prototype key', template: '{{ lookup repo "__proto__" }}' },
      { name: 'a defineGetter reference', template: '{{ repo.__defineGetter__ }}' },
      { name: 'this.constructor', template: '{{#with repo}}{{ this.constructor.name }}{{/with}}' },
    ])('renders $name as nothing', async ({ template }) => {
      workspace = await Workspace.create({ [TEMPLATE]: template });

      await render({ variables: JSON.stringify({ repo: { name: 'actions' } }), strict: 'false' });

      await expect(workspace.read(OUTPUT)).resolves.toBe('');
    });

    it.each([
      { name: '__proto__', variables: '{"__proto__":{"polluted":true}}' },
      { name: 'a nested __proto__', variables: '{"a":{"__proto__":{"polluted":true}}}' },
      { name: 'constructor', variables: '{"constructor":{"prototype":{"polluted":true}}}' },
      { name: 'prototype', variables: '{"prototype":{"polluted":true}}' },
    ])('refuses variables carrying $name', async ({ variables }) => {
      workspace = await Workspace.create({ [TEMPLATE]: 'x' });

      const result = await render({ variables }, 'failure');

      expectCleanRejection(result, /prototype/);
      await expect(workspace.exists(OUTPUT)).resolves.toBe(false);
    });

    it('refuses a partial that recurses into itself rather than exhausting the stack', async () => {
      workspace = await Workspace.create({
        [TEMPLATE]: '{{> loop }}',
        'partials/loop.hbs': 'x{{> loop }}',
      });

      const result = await render({ 'partials-dir': 'partials' }, 'failure');

      expectCleanRejection(result);
      expect(result.stderr, 'a stack overflow would kill the process, not fail the step').not.toContain(
        'Maximum call stack',
      );
    }, 60_000);
  });

  describe('size and shape', () => {
    it('renders a template far larger than any real README', async () => {
      workspace = await Workspace.create({ [TEMPLATE]: `${oversized(2 * 1024 * 1024)}\n` });

      const result = await render({});

      expect(result.outputs['changed']).toBe('true');
      expect(result.outputs['checksum']).toMatch(/^[0-9a-f]{64}$/);
    }, 120_000);

    it.each([
      { name: 'a JSON array', variables: '["a","b"]' },
      { name: 'a JSON string', variables: '"just a string"' },
      { name: 'a JSON number', variables: '42' },
      { name: 'JSON null', variables: 'null' },
      { name: 'YAML rather than JSON', variables: 'title: Actions\n' },
      { name: 'a truncated object', variables: '{"a":' },
      { name: 'a duplicated key', variables: '{"a":1,"a":2}', tolerated: true },
    ])('handles variables that are $name', async ({ variables, tolerated }) => {
      workspace = await Workspace.create({ [TEMPLATE]: 'x' });

      const result = await render({ variables }, tolerated === true ? 'success' : 'failure');

      if (tolerated !== true) {
        expectCleanRejection(result, /variables/);
        await expect(workspace.exists(OUTPUT)).resolves.toBe(false);
      }
    });
  });
});
