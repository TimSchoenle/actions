import { describe, expect, it } from 'vitest';

import { FileCommandParseError, parseFileCommands } from './github-file-commands.js';

/** Reproduces what `@actions/core.setOutput` appends, delimiter and all. */
function heredoc(key: string, value: string, eol = '\n'): string {
  const delimiter = 'ghadelimiter_11111111-2222-3333-4444-555555555555';

  return `${key}<<${delimiter}${eol}${value}${eol}${delimiter}${eol}`;
}

describe('parseFileCommands', () => {
  it('reads the heredoc form written by @actions/core', () => {
    expect(parseFileCommands(heredoc('sha', 'abc123'))).toEqual({ sha: 'abc123' });
  });

  it('reads a heredoc written with CRLF line endings', () => {
    expect(parseFileCommands(heredoc('sha', 'abc123', '\r\n'))).toEqual({ sha: 'abc123' });
  });

  it('keeps a multiline value intact', () => {
    expect(parseFileCommands(heredoc('body', 'first\nsecond'))).toEqual({ body: 'first\nsecond' });
  });

  it('does not mistake a key=value line inside a value for a pair', () => {
    expect(parseFileCommands(heredoc('body', 'note=this is prose'))).toEqual({ body: 'note=this is prose' });
  });

  it('reads the flat form a shell step appends', () => {
    expect(parseFileCommands('branch=main\ncreated=true\n')).toEqual({ branch: 'main', created: 'true' });
  });

  it('resolves a repeated key to its last value, as the runner does', () => {
    expect(parseFileCommands(`${heredoc('sha', 'first')}${heredoc('sha', 'second')}`)).toEqual({ sha: 'second' });
  });

  it('yields nothing for a file no action wrote to', () => {
    expect(parseFileCommands('')).toEqual({});
  });

  it('rejects a value whose delimiter never closes', () => {
    expect(() => parseFileCommands('body<<DELIM\nunterminated\n')).toThrow(FileCommandParseError);
  });
});
