import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { EOL, tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as core from './core.js';

/** Everything written to stdout while the test runs. */
let stdout: string[];
let directory: string;
const savedEnv = { ...process.env };

beforeEach(async () => {
  stdout = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));

    return true;
  });
  directory = await mkdtemp(path.join(tmpdir(), 'core-'));

  for (const name of ['GITHUB_OUTPUT', 'GITHUB_PATH', 'GITHUB_STEP_SUMMARY']) {
    delete process.env[name];
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const name of Object.keys(process.env)) {
    if (!(name in savedEnv)) {
      delete process.env[name];
    }
  }
  Object.assign(process.env, savedEnv);
  process.exitCode = undefined;
  await rm(directory, { recursive: true, force: true });
});

/** Creates an empty command file, as the runner does before a step starts, and names it in `variable`. */
async function commandFile(variable: string): Promise<string> {
  const file = path.join(directory, variable);
  await writeFile(file, '');
  process.env[variable] = file;

  return file;
}

describe('getInput', () => {
  it('maps the name to INPUT_, upper-cased with spaces as underscores', () => {
    process.env['INPUT_MY_LONG_NAME'] = 'value';

    expect(core.getInput('my long name')).toBe('value');
    expect(core.getInput('My Long Name')).toBe('value');
  });

  it('trims unless told not to', () => {
    process.env.INPUT_PADDED = '  value \n';

    expect(core.getInput('padded')).toBe('value');
    expect(core.getInput('padded', { trimWhitespace: false })).toBe('  value \n');
  });

  it('reads a missing input as empty', () => {
    expect(core.getInput('absent')).toBe('');
  });

  it('refuses a required input that is empty or unset', () => {
    process.env.INPUT_EMPTY = '';

    expect(() => core.getInput('empty', { required: true })).toThrow('Input required and not supplied: empty');
    expect(() => core.getInput('absent', { required: true })).toThrow('Input required and not supplied: absent');
  });

  it('accepts a required input that is only whitespace, and trims it to empty', () => {
    process.env.INPUT_BLANK = '   ';

    expect(core.getInput('blank', { required: true })).toBe('');
  });
});

describe('getMultilineInput', () => {
  it('splits on newlines, drops empty lines and trims each', () => {
    process.env.INPUT_LIST = 'a\n\n  b  \n';

    expect(core.getMultilineInput('list')).toEqual(['a', 'b']);
  });

  it('keeps whitespace when told to, dropping only empty lines', () => {
    process.env.INPUT_LIST = ' a \n\n b';

    expect(core.getMultilineInput('list', { trimWhitespace: false })).toEqual([' a ', ' b']);
  });

  it('keeps a whitespace-only line that trimming the whole value did not remove', () => {
    process.env.INPUT_LIST = 'a\n  \nb';

    expect(core.getMultilineInput('list')).toEqual(['a', '', 'b']);
  });
});

describe('getBooleanInput', () => {
  it.each(['true', 'True', 'TRUE', ' true '])('reads %o as true', (value) => {
    process.env.INPUT_FLAG = value;

    expect(core.getBooleanInput('flag')).toBe(true);
  });

  it.each(['false', 'False', 'FALSE'])('reads %o as false', (value) => {
    process.env.INPUT_FLAG = value;

    expect(core.getBooleanInput('flag')).toBe(false);
  });

  it.each(['', 'yes', 'tRUE', '1'])('refuses %o', (value) => {
    process.env.INPUT_FLAG = value;

    expect(() => core.getBooleanInput('flag')).toThrow(TypeError);
    expect(() => core.getBooleanInput('flag')).toThrow(
      'Input does not meet YAML 1.2 "Core Schema" specification: flag\n' +
        'Support boolean input list: `true | True | TRUE | false | False | FALSE`',
    );
  });
});

describe('setOutput', () => {
  it('appends a heredoc entry to GITHUB_OUTPUT', async () => {
    const file = await commandFile('GITHUB_OUTPUT');

    core.setOutput('name', 'multi\nline');
    core.setOutput('count', 3 as unknown as string);

    const content = await readFile(file, 'utf8');

    expect(content).toMatch(
      new RegExp(
        `^name<<(ghadelimiter_[\\da-f-]+)${EOL}multi\\nline${EOL}\\1${EOL}count<<(ghadelimiter_[\\da-f-]+)${EOL}3${EOL}\\2${EOL}$`,
      ),
    );
    expect(stdout).toEqual([]);
  });

  it('fails when the runner named a file that does not exist', () => {
    process.env.GITHUB_OUTPUT = path.join(directory, 'missing');

    expect(() => core.setOutput('name', 'value')).toThrow(`Missing file at path: ${process.env.GITHUB_OUTPUT}`);
  });

  it('falls back to the set-output command without an output file', () => {
    core.setOutput('name', 'a\nb');

    expect(stdout).toEqual([EOL, `::set-output name=name::a%0Ab${EOL}`]);
  });
});

describe('addPath', () => {
  it('appends to GITHUB_PATH and prepends to PATH', async () => {
    const file = await commandFile('GITHUB_PATH');
    process.env.PATH = '/usr/bin';

    core.addPath('/opt/tool');

    expect(await readFile(file, 'utf8')).toBe(`/opt/tool${EOL}`);
    expect(process.env.PATH).toBe(`/opt/tool${path.delimiter}/usr/bin`);
  });

  it('falls back to the add-path command without a path file', () => {
    core.addPath('/opt/tool');

    expect(stdout).toEqual([`::add-path::/opt/tool${EOL}`]);
  });
});

describe('logging', () => {
  it('writes info verbatim and the other levels as escaped commands', () => {
    core.info('plain %0A text');
    core.debug('d\ne');
    core.setSecret('s3cr%t');
    core.startGroup('Group: one');
    core.endGroup();

    expect(stdout).toEqual([
      `plain %0A text${EOL}`,
      `::debug::d%0Ae${EOL}`,
      `::add-mask::s3cr%25t${EOL}`,
      `::group::Group: one${EOL}`,
      `::endgroup::${EOL}`,
    ]);
  });

  it('writes annotations with their properties', () => {
    core.error('e', { title: 'T', file: 'a.ts', startLine: 1, endLine: 2, startColumn: 3, endColumn: 4 });
    core.warning('w');
    core.notice(new Error('n'));

    expect(stdout).toEqual([
      `::error title=T,file=a.ts,line=1,endLine=2,col=3,endColumn=4::e${EOL}`,
      `::warning::w${EOL}`,
      `::notice::Error: n${EOL}`,
    ]);
  });

  it('cannot be steered into a second command by its message', () => {
    core.warning('x\n::error::forged', { title: 'a,file=b' });

    expect(stdout).toEqual([`::warning title=a%2Cfile=b::x%0A::error::forged${EOL}`]);
  });
});

describe('setFailed', () => {
  it('sets exit code 1 and writes an error annotation', () => {
    core.setFailed('broken');

    expect(process.exitCode).toBe(core.ExitCode.Failure);
    expect(stdout).toEqual([`::error::broken${EOL}`]);
  });
});
