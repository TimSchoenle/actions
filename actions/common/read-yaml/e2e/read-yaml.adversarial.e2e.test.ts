import { fileURLToPath } from 'node:url';

import {
  commandInjectionPayload,
  expectCleanRejection,
  expectNoInjection,
  fileCommandInjectionPayload,
  HOSTILE_CHARACTERS,
  oversized,
  runAction,
  TRAVERSAL_PATHS,
  Workspace,
  yamlAliasBomb,
} from 'actions-e2e';
import { afterEach, describe, expect, it } from 'vitest';

import type { ActionInput, ActionOutput } from '../src/generated/action-io.js';
import type { ExpectedOutcome } from 'actions-e2e';

/**
 * Hostile cases for `actions/common/read-yaml`.
 *
 * This action's threat model is the sharpest of the filesystem three: the *file* is repository
 * content, so on a `pull_request` trigger everything it reads was written by whoever opened the pull
 * request. Whatever it does with that content, it must not let it become an instruction — and the
 * action's own log line is where that nearly went wrong, because `core.info` writes to the stream the
 * runner parses for commands.
 */

const ACTION_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

const FIXTURE_PATH = 'hostile.yaml';

/** Wraps a value as a YAML block scalar, so its line structure reaches the action intact. */
function blockScalar(value: string): string {
  return `value: |-\n${value
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')}\n`;
}

describe('read-yaml under hostile input', () => {
  let workspace: Workspace;

  afterEach(async () => {
    await workspace.dispose();
  });

  async function read(
    document: string,
    key = 'value',
    expected: ExpectedOutcome = 'success',
  ): ReturnType<typeof runAction<ActionInput, ActionOutput>> {
    workspace = await Workspace.create({ [FIXTURE_PATH]: document });

    return runAction<ActionInput, ActionOutput>({
      actionDirectory: ACTION_DIRECTORY,
      inputs: { file: FIXTURE_PATH, key },
      workspace,
      expect: expected,
    });
  }

  describe('workflow command injection', () => {
    // The regression test for the real defect: this action logged the value it read straight to
    // stdout, so a multi-line value forged `::error::` and `::add-mask::` on a live runner.
    it('publishes a value that forges every workflow command, without any of them taking effect', async () => {
      const payload = commandInjectionPayload();

      const result = await read(blockScalar(payload));

      expect(result.outputs['value'], 'the value is still published in full, as data').toBe(payload);
      expectNoInjection(result);
    });

    it('forges nothing through the key it failed to find', async () => {
      const result = await read('a: 1\n', commandInjectionPayload('missing.key'), 'failure');

      expectCleanRejection(result, /not found/);
      expectNoInjection(result);
    });

    it('forges nothing through the file path it could not read', async () => {
      workspace = await Workspace.create({});

      const result = await runAction<ActionInput, ActionOutput>({
        actionDirectory: ACTION_DIRECTORY,
        inputs: { file: commandInjectionPayload('absent.yaml'), key: 'value' },
        workspace,
        expect: 'failure',
      });

      expectCleanRejection(result);
      expectNoInjection(result);
    });

    it('forges nothing through a key that is itself a workflow command', async () => {
      const result = await read('::error::not-really-a-command: 1\n', '::error::not-really-a-command');

      expect(result.outputs['value']).toBe('1');
      expectNoInjection(result);
    });
  });

  describe('command file injection', () => {
    it('writes one output when the value is shaped like the output file format', async () => {
      const payload = fileCommandInjectionPayload();

      const result = await read(blockScalar(payload));

      expect(Object.keys(result.outputs), 'exactly the declared output, and nothing beside it').toEqual(['value']);
      expect(result.outputs['value']).toBe(payload);
      expectNoInjection(result);
    });

    it('exports nothing to the environment of later steps', async () => {
      const result = await read(blockScalar(fileCommandInjectionPayload()));

      expect(result.exportedEnv).toEqual({});
      expect(result.state).toEqual({});
      expect(result.addedPath).toEqual([]);
    });
  });

  describe('hostile characters', () => {
    it.each(HOSTILE_CHARACTERS)('round-trips $name ($risk) as data', async ({ value }) => {
      // Quoted in the document so YAML preserves the character rather than reinterpreting it.
      const result = await read(`value: ${JSON.stringify(`before${value}after`)}\n`);

      expect(result.outputs['value']).toBe(`before${value}after`);
      expectNoInjection(result);
    });
  });

  describe('malformed and abusive documents', () => {
    it('refuses an alias bomb instead of expanding it', async () => {
      const started = Date.now();

      const result = await read(yamlAliasBomb(), 'l8', 'failure');

      // The `yaml` parser caps alias expansion; without that cap this is an out-of-memory kill.
      expectCleanRejection(result, /alias/i);
      expect(Date.now() - started, 'must fail fast, not grind').toBeLessThan(30_000);
    }, 60_000);

    it.each([
      { name: 'a merge key reaching a prototype', document: 'value:\n  <<: {a: 1}\n', key: 'value.__proto__' },
      { name: 'a constructor key', document: 'a: 1\n', key: 'constructor.prototype' },
      { name: 'a prototype key', document: 'a: 1\n', key: 'prototype' },
      { name: 'a toString key', document: 'a: 1\n', key: 'toString' },
      { name: '__proto__ on a document that has no such key', document: 'a: 1\n', key: '__proto__.polluted' },
    ])('reports $name as absent rather than resolving it', async ({ document, key }) => {
      const result = await read(document, key, 'failure');

      expectCleanRejection(result, /not found/);
    });

    // Not pollution, and worth pinning as such: the key path is resolved against the parsed YAML
    // *document*, not against a JavaScript object, so `__proto__` addresses a node that is literally
    // in the file and nothing else. The case above proves the same path finds nothing when it is not.
    it('reads a literal __proto__ key as the ordinary data it is', async () => {
      const result = await read('__proto__:\n  polluted: true\n', '__proto__.polluted');

      expect(result.outputs['value']).toBe('true');
    });

    it.each([
      { name: 'an unterminated quote', document: 'value: "unclosed\n' },
      { name: 'a tab where indentation is expected', document: 'a:\n\tvalue: 1\n' },
      { name: 'a duplicate key', document: 'value: 1\nvalue: 2\n' },
      { name: 'a NUL byte in the stream', document: `value: a${String.fromCodePoint(0)}b\n` },
    ])('either reads or rejects $name, but never crashes', async ({ document }) => {
      const result = await read(document, 'value', 'any');

      // Whichever way it goes, the step must have decided — not died. `expect: 'any'` is the point:
      // the contract is "a string output or an annotated failure", never a stack trace on stderr.
      if (result.exitCode === 0) {
        expect(typeof result.outputs['value']).toBe('string');
      } else {
        expectCleanRejection(result);
      }

      expect(result.stderr).not.toContain('UnhandledPromiseRejection');
    });

    it('carries a value far larger than any real chart value', async () => {
      const payload = oversized(512 * 1024);

      const result = await read(`value: ${payload}\n`);

      expect(result.outputs['value']).toHaveLength(payload.length);
    });
  });

  describe('path handling', () => {
    it.each(TRAVERSAL_PATHS)('fails legibly on $name rather than dumping what it found', async ({ value }) => {
      workspace = await Workspace.create({});

      const result = await runAction<ActionInput, ActionOutput>({
        actionDirectory: ACTION_DIRECTORY,
        inputs: { file: value, key: 'value' },
        workspace,
        expect: 'any',
      });

      // The action is not confined to the workspace — `file` is a workflow-supplied path and an
      // absolute one is a legitimate use. What must hold is that a path it cannot use fails with a
      // message naming the path, and that a path it *can* use still publishes only the addressed key.
      if (result.exitCode === 0) {
        expect(Object.keys(result.outputs)).toEqual(['value']);
      } else {
        expectCleanRejection(result);
      }

      expectNoInjection(result);
    });

    it('reads through a symbolic link without following it into a command', async () => {
      if (!(await Workspace.symlinksSupported())) {
        return;
      }

      workspace = await Workspace.create({ 'real.yaml': blockScalar(commandInjectionPayload()) });
      await workspace.symlink('link.yaml', 'real.yaml');

      const result = await runAction<ActionInput, ActionOutput>({
        actionDirectory: ACTION_DIRECTORY,
        inputs: { file: 'link.yaml', key: 'value' },
        workspace,
      });

      expect(result.outputs['value']).toBe(commandInjectionPayload());
      expectNoInjection(result);
    });
  });
});
