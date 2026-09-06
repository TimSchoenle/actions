import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { UnsafePathError } from 'actions-util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BodySourceError, resolveBody } from './body.js';

describe('resolveBody', () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'upsert-pr-comment-'));
    await writeFile(path.join(workspace, 'report.md'), '| image | size |\n', 'utf8');
    await writeFile(path.join(workspace, 'blank.md'), '  \n\n', 'utf8');
  });

  afterAll(() => rm(workspace, { force: true, recursive: true }));

  it('returns an inline body unchanged', async () => {
    await expect(resolveBody({ body: 'the report', bodyFile: '' }, workspace)).resolves.toBe('the report');
  });

  it('reads a body from a file in the workspace', async () => {
    await expect(resolveBody({ body: '', bodyFile: 'report.md' }, workspace)).resolves.toBe('| image | size |\n');
  });

  it('refuses both inputs at once rather than silently preferring one', async () => {
    await expect(resolveBody({ body: 'inline', bodyFile: 'report.md' }, workspace)).rejects.toThrow(BodySourceError);
  });

  it('refuses neither input', async () => {
    await expect(resolveBody({ body: '', bodyFile: '' }, workspace)).rejects.toThrow("one of 'body' and 'body_file'");
  });

  it('refuses a file that holds nothing but whitespace', async () => {
    await expect(resolveBody({ body: '', bodyFile: 'blank.md' }, workspace)).rejects.toThrow('is empty');
  });

  it.each(['../escaped.md', '/etc/passwd', 'reports/../../escaped.md'])(
    'refuses the escaping path %j',
    async (bodyFile) => {
      await expect(resolveBody({ body: '', bodyFile }, workspace)).rejects.toThrow(UnsafePathError);
    },
  );

  it('reports a missing file as a read failure, naming it', async () => {
    await expect(resolveBody({ body: '', bodyFile: 'absent.md' }, workspace)).rejects.toThrow('absent.md');
  });
});
