import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { UnsafePathError } from 'actions-util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BodySourceError, composeLines, resolveBody } from './body.js';

import type { BodySource } from './body.js';

/** A source with nothing set, for each case to fill in the inputs it is about. */
function source(overrides: Partial<BodySource>): BodySource {
  return { body: '', bodyFile: '', bodyLines: '', footer: '', header: '', ...overrides };
}

describe('composeLines', () => {
  it('drops blank lines and keeps the rest in input order', () => {
    expect(composeLines('- b\n\n- a\n\n- c\n', '', '')).toBe('- b\n- a\n- c');
  });

  it('drops whitespace-only lines but keeps the indent of a surviving one', () => {
    expect(composeLines('- parent\n   \t\n  - child\n', '', '')).toBe('- parent\n  - child');
  });

  it('keeps the indent of the first surviving line', () => {
    expect(composeLines('\n  - nested\n', '', '')).toBe('  - nested');
  });

  it('splits CRLF into the same lines as LF', () => {
    expect(composeLines('- a\r\n\r\n- b\r\n', '', '')).toBe('- a\n- b');
  });

  it('places the header and footer one blank line away from the lines', () => {
    expect(composeLines('- a\n- b', 'Updated:', 'Closing.')).toBe('Updated:\n\n- a\n- b\n\nClosing.');
  });

  it.each(['', '\n', '  \n\t\n', '\r\n\r\n'])('reports nothing to post for the blank input %j', (lines) => {
    expect(composeLines(lines, '', '')).toBeUndefined();
  });

  it('never turns a header and footer with no surviving line into a comment', () => {
    expect(composeLines('\n\n', 'Updated:', 'Closing.')).toBeUndefined();
  });
});

describe('resolveBody', () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'upsert-pr-comment-'));
    await writeFile(path.join(workspace, 'report.md'), '| image | size |\n', 'utf8');
    await writeFile(path.join(workspace, 'blank.md'), '  \n\n', 'utf8');
  });

  afterAll(() => rm(workspace, { force: true, recursive: true }));

  it('returns an inline body unchanged', async () => {
    await expect(resolveBody(source({ body: 'the report' }), workspace)).resolves.toBe('the report');
  });

  it('reads a body from a file in the workspace', async () => {
    await expect(resolveBody(source({ bodyFile: 'report.md' }), workspace)).resolves.toBe('| image | size |\n');
  });

  it.each([
    { body: 'inline', bodyFile: 'report.md' },
    { body: 'inline', bodyLines: '- a' },
    { bodyFile: 'report.md', bodyLines: '- a' },
    { body: 'inline', bodyFile: 'report.md', bodyLines: '- a' },
  ])('refuses %j rather than silently preferring one source', async (inputs) => {
    await expect(resolveBody(source(inputs), workspace)).rejects.toThrow(
      new BodySourceError("only one of 'body', 'body_file' and 'body_lines' may be set"),
    );
  });

  it('refuses no source at all, naming all three', async () => {
    await expect(resolveBody(source({}), workspace)).rejects.toThrow(
      "one of 'body', 'body_file' and 'body_lines' must be set",
    );
  });

  it.each([
    [{ body: 'inline', header: 'Updated:' }, "'header' is only valid with 'body_lines'"],
    [{ bodyFile: 'report.md', header: 'Updated:' }, "'header' is only valid with 'body_lines'"],
    [{ body: 'inline', footer: 'Closing.' }, "'footer' is only valid with 'body_lines'"],
    [{ bodyFile: 'report.md', footer: 'Closing.' }, "'footer' is only valid with 'body_lines'"],
  ])('refuses %j rather than dropping text the workflow asked for', async (inputs, message) => {
    await expect(resolveBody(source(inputs), workspace)).rejects.toThrow(new BodySourceError(message));
  });

  it('composes body_lines with its header and footer', async () => {
    const inputs = source({ bodyLines: '\n- `README.md`\n', footer: 'Closing.', header: 'Updated:' });

    await expect(resolveBody(inputs, workspace)).resolves.toBe('Updated:\n\n- `README.md`\n\nClosing.');
  });

  it('skips when every line of body_lines is blank, where an empty body_file fails', async () => {
    const inputs = source({ bodyLines: '\n  \n', footer: 'Closing.', header: 'Updated:' });

    await expect(resolveBody(inputs, workspace)).resolves.toBeUndefined();
  });

  it('refuses a file that holds nothing but whitespace', async () => {
    await expect(resolveBody(source({ bodyFile: 'blank.md' }), workspace)).rejects.toThrow('is empty');
  });

  it.each(['../escaped.md', '/etc/passwd', 'reports/../../escaped.md'])(
    'refuses the escaping path %j',
    async (bodyFile) => {
      await expect(resolveBody(source({ bodyFile }), workspace)).rejects.toThrow(UnsafePathError);
    },
  );

  it('reports a missing file as a read failure, naming it', async () => {
    await expect(resolveBody(source({ bodyFile: 'absent.md' }), workspace)).rejects.toThrow('absent.md');
  });
});
