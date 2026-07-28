import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OutputDriftError } from './errors.js';
import { applyOutput, describeDrift } from './output.js';

const WRITE = { check: false };
const CHECK = { check: true };

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

describe('describeDrift', () => {
  it('says the file is absent when there is nothing on disk', () => {
    expect(describeDrift(undefined, 'a')).toMatch(/does not exist/);
  });

  it('points at the first differing line, one-indexed', () => {
    expect(describeDrift('a\nb\nc', 'a\nB\nc')).toMatch(/line 2/);
  });

  it('quotes both sides of the difference', () => {
    const detail = describeDrift('a\nold\n', 'a\nnew\n');

    expect(detail).toMatch(/on disk:\s+old/);
    expect(detail).toMatch(/rendered:\s+new/);
  });

  it('elides a very long line rather than flooding the log', () => {
    const detail = describeDrift('x'.repeat(500), 'y'.repeat(500));

    expect(detail).toContain('…');
    expect(detail.length).toBeLessThan(500);
  });

  // The rendered content only grew, so no line the file has disagrees and there is no position to
  // point at — the difference is the suffix the file is missing.
  it('reports a length difference when the file is a line-wise prefix of the rendering', () => {
    expect(describeDrift('a', 'a\nb')).toMatch(/has 1 line\(s\), the rendered content has 2/);
  });

  it('marks a line the rendering no longer has as the end of the file', () => {
    expect(describeDrift('a\nb', 'a')).toMatch(/<end of file>/);
  });
});

describe('applyOutput', () => {
  let directory: string;
  let outputPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'render-output-'));
    outputPath = path.join(directory, 'README.md');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  describe('write mode', () => {
    it('creates a file that does not exist and reports it as changed', async () => {
      const outcome = await applyOutput(outputPath, 'content', WRITE);

      expect(outcome.changed).toBe(true);
      await expect(readFile(outputPath, 'utf8')).resolves.toBe('content');
    });

    it('overwrites a file whose content differs', async () => {
      await writeFile(outputPath, 'old', 'utf8');

      const outcome = await applyOutput(outputPath, 'new', WRITE);

      expect(outcome.changed).toBe(true);
      await expect(readFile(outputPath, 'utf8')).resolves.toBe('new');
    });

    it('reports an identical file as unchanged', async () => {
      await writeFile(outputPath, 'same', 'utf8');

      await expect(applyOutput(outputPath, 'same', WRITE)).resolves.toMatchObject({ changed: false });
    });

    // A generated README is unchanged on nearly every run. Rewriting identical bytes would move the
    // modification time and defeat anything keyed on it.
    it('leaves an unchanged file completely untouched', async () => {
      await writeFile(outputPath, 'same', 'utf8');
      const before = await stat(outputPath);

      await new Promise((resolve) => setTimeout(resolve, 10));
      await applyOutput(outputPath, 'same', WRITE);

      expect((await stat(outputPath)).mtimeMs).toBe(before.mtimeMs);
    });

    it('creates missing parent directories', async () => {
      const nested = path.join(directory, 'docs', 'generated', 'README.md');

      await applyOutput(nested, 'content', WRITE);

      await expect(readFile(nested, 'utf8')).resolves.toBe('content');
    });

    it('is idempotent: a second application changes nothing', async () => {
      await applyOutput(outputPath, 'content', WRITE);

      await expect(applyOutput(outputPath, 'content', WRITE)).resolves.toMatchObject({ changed: false });
    });
  });

  describe('check mode', () => {
    it('passes when the file already matches', async () => {
      await writeFile(outputPath, 'same', 'utf8');

      await expect(applyOutput(outputPath, 'same', CHECK)).resolves.toMatchObject({ changed: false });
    });

    it('fails when the file is stale', async () => {
      await writeFile(outputPath, 'old', 'utf8');

      await expect(applyOutput(outputPath, 'new', CHECK)).rejects.toThrow(OutputDriftError);
    });

    it('fails when the file does not exist', async () => {
      await expect(applyOutput(outputPath, 'new', CHECK)).rejects.toThrow(OutputDriftError);
    });

    it('includes the first difference in the failure', async () => {
      await writeFile(outputPath, 'a\nold\n', 'utf8');

      await expect(applyOutput(outputPath, 'a\nnew\n', CHECK)).rejects.toThrow(/line 2/);
    });

    it('never writes, not even when the file is stale', async () => {
      await writeFile(outputPath, 'old', 'utf8');

      await expect(applyOutput(outputPath, 'new', CHECK)).rejects.toThrow(OutputDriftError);
      await expect(readFile(outputPath, 'utf8')).resolves.toBe('old');
    });

    it('never creates the file', async () => {
      await expect(applyOutput(outputPath, 'new', CHECK)).rejects.toThrow(OutputDriftError);
      await expect(stat(outputPath)).rejects.toThrow();
    });
  });

  describe('checksum', () => {
    it('is the SHA-256 of the rendered content', async () => {
      const outcome = await applyOutput(outputPath, 'content', WRITE);

      expect(outcome.checksum).toBe(sha256('content'));
    });

    // The checksum describes what was rendered, so it is comparable across a check run and a write
    // run of the same inputs.
    it('is the same in check mode as in write mode', async () => {
      const written = await applyOutput(outputPath, 'content', WRITE);
      const checked = await applyOutput(outputPath, 'content', CHECK);

      expect(checked.checksum).toBe(written.checksum);
    });

    it('propagates an unexpected read failure rather than treating it as a missing file', async () => {
      await expect(applyOutput(directory, 'content', WRITE)).rejects.toThrow();
    });
  });
});
