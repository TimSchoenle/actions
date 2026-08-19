import { describe, expect, it } from 'vitest';

import { parseArgumentVector } from './argument-vector.js';
import { InvalidInputError } from './errors.js';

const INPUT = 'extra_args';

function parse(value: string): string[] {
  return parseArgumentVector(value, INPUT);
}

describe('parseArgumentVector', () => {
  it('reads an empty input as no arguments rather than as one empty argument', () => {
    expect(parse('')).toEqual([]);
    expect(parse('   \n  ')).toEqual([]);
  });

  it('splits the ordinary case on whitespace', () => {
    expect(parse('--service api')).toEqual(['--service', 'api']);
  });

  it('reads a multiline input, which is how a workflow writes a long list', () => {
    expect(parse('--service api\n--strict\n')).toEqual(['--service', 'api', '--strict']);
  });

  it('collapses runs of whitespace rather than emitting empty arguments', () => {
    expect(parse('  --service \t  api  ')).toEqual(['--service', 'api']);
  });

  // The whole reason this is a parser: an argument holding a space has to survive as one argument,
  // and the only place that can be decided is where the quotes are still visible.
  it.each([
    { name: 'double quotes', value: '--profile "my profile"' },
    { name: 'single quotes', value: "--profile 'my profile'" },
  ])('keeps a value quoted with $name as one argument', ({ value }) => {
    expect(parse(value)).toEqual(['--profile', 'my profile']);
  });

  it('lets each quote carry the other verbatim', () => {
    expect(parse(`--name "it's" --other 'say "hi"'`)).toEqual(['--name', "it's", '--other', 'say "hi"']);
  });

  it('joins a quoted span to what abuts it, the way a shell does', () => {
    expect(parse('--service="the api"')).toEqual(['--service=the api']);
  });

  it('reads an explicitly empty quoted argument as one empty argument', () => {
    expect(parse(`--suffix ''`)).toEqual(['--suffix', '']);
  });

  // A backslash is an ordinary character in the Windows paths and regular expressions an argument
  // may carry. Reading it as an escape would silently eat one.
  it('treats a backslash as an ordinary character', () => {
    expect(parse(String.raw`--root C:\config`)).toEqual(['--root', String.raw`C:\config`]);
  });

  it.each([
    { name: 'an unclosed double quote', value: '--profile "my profile' },
    { name: 'an unclosed single quote', value: "--profile 'my profile" },
  ])('refuses $name rather than guessing where the argument ends', ({ value }) => {
    expect(() => parse(value)).toThrow(InvalidInputError);
    expect(() => parse(value)).toThrow(/unclosed/);
  });

  // `--format` decides which rendering the run is about and `--path` is what the embedded-contract
  // check compares against. A second spelling of either leaves the action reporting on a rendering
  // it did not ask for.
  it.each([
    { name: 'a second --format', value: '--format labels' },
    { name: 'a second --path', value: '--path /etc/passwd' },
    { name: 'a second --format written with an equals sign', value: '--format=labels' },
    { name: 'a second --path written with an equals sign', value: '--path=/etc/passwd' },
    { name: 'a reserved argument buried in a longer list', value: '--service api --strict --format labels' },
  ])('refuses $name', ({ value }) => {
    expect(() => parse(value)).toThrow(InvalidInputError);
    expect(() => parse(value)).toThrow(/this action's own arguments/);
  });

  it('accepts an argument that merely starts like a reserved one', () => {
    expect(parse('--format-version 2 --paths a')).toEqual(['--format-version', '2', '--paths', 'a']);
  });

  // A newline inside an argument is a line the runner reads for workflow commands, and a NUL is not
  // something an argument vector can carry at all.
  it.each([
    { name: 'a newline', value: '"a\nb"' },
    { name: 'a carriage return', value: `'a\rb'` },
    { name: 'a NUL', value: '"a\u0000b"' },
    { name: 'a tab', value: '"a\tb"' },
    { name: 'a delete character', value: '"a\u007Fb"' },
  ])('refuses an argument holding $name', ({ value }) => {
    expect(() => parse(value)).toThrow(/control character/);
  });

  it('refuses a list past the limit rather than assembling a command line out of it', () => {
    expect(() => parse(Array.from({ length: 40 }, (_, index) => `--f${index}`).join(' '))).toThrow(/past the limit/);
  });

  it('refuses an oversized input before it splits it into anything', () => {
    expect(() => parse('a'.repeat(5000))).toThrow(/past the limit of 4096/);
  });

  it('names the input it was given, since the message is what a workflow author acts on', () => {
    expect(() => parseArgumentVector('"unclosed', 'some_input')).toThrow(/^some_input: /);
  });

  // Nothing downstream re-splits, so a shell metacharacter is an ordinary character here: it reaches
  // the generator as one argument and no shell ever sees it.
  it.each(['--service', 'api;id', 'a$(id)', 'a`id`', 'a|b', 'a&&b', '--service=<script>'])(
    'passes %s through as one argument, since no shell re-reads it',
    (value) => {
      expect(parse(value)).toEqual([value]);
    },
  );
});
