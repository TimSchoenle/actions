import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { EOL, tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Summary } from './summary.js';

describe('Summary', () => {
  let directory: string;
  let file: string;
  const saved = process.env.GITHUB_STEP_SUMMARY;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'summary-'));
    file = path.join(directory, 'summary.md');
    await writeFile(file, 'existing\n');
    process.env.GITHUB_STEP_SUMMARY = file;
  });

  afterEach(async () => {
    if (saved === undefined) {
      delete process.env.GITHUB_STEP_SUMMARY;
    } else {
      process.env.GITHUB_STEP_SUMMARY = saved;
    }
    await rm(directory, { recursive: true, force: true });
  });

  it('renders the markup @actions/core renders', () => {
    const summary = new Summary()
      .addHeading('Title', 2)
      .addHeading('Fallback', 9)
      .addRaw('text')
      .addRaw(' more', true)
      .addTable([
        [
          { data: 'H', header: true },
          { data: 'Wide', colspan: '2' },
        ],
        ['a', { data: 'b', rowspan: '3' }, ''],
      ]);

    expect(summary.stringify()).toBe(
      `<h2>Title</h2>${EOL}<h1>Fallback</h1>${EOL}text more${EOL}` +
        `<table><tr><th>H</th><td colspan="2">Wide</td></tr><tr><td>a</td><td rowspan="3">b</td><td></tr></table>${EOL}`,
    );
  });

  it('appends the buffer to the summary file and empties it', async () => {
    const summary = new Summary().addRaw('one', true);

    await summary.write();
    expect(summary.isEmptyBuffer()).toBe(true);

    await summary.addRaw('two').write();

    expect(await readFile(file, 'utf8')).toBe(`existing\none${EOL}two`);
  });

  it('overwrites the file when told to', async () => {
    await new Summary().addRaw('only').write({ overwrite: true });

    expect(await readFile(file, 'utf8')).toBe('only');
  });

  it('keeps writing to the file it resolved first', async () => {
    const summary = new Summary();
    await summary.addRaw('first').write();

    process.env.GITHUB_STEP_SUMMARY = path.join(directory, 'other.md');
    await summary.addRaw('second').write();

    expect(await readFile(file, 'utf8')).toBe('existing\nfirstsecond');
  });

  it('refuses to write without a summary file', async () => {
    delete process.env.GITHUB_STEP_SUMMARY;

    await expect(new Summary().addRaw('x').write()).rejects.toThrow(
      'Unable to find environment variable for $GITHUB_STEP_SUMMARY',
    );
  });

  it('refuses a summary file it cannot access', async () => {
    process.env.GITHUB_STEP_SUMMARY = path.join(directory, 'missing', 'summary.md');

    await expect(new Summary().addRaw('x').write()).rejects.toThrow('Unable to access summary file');
  });

  it('discards the buffer on emptyBuffer', () => {
    expect(new Summary().addRaw('x').emptyBuffer().stringify()).toBe('');
  });
});
