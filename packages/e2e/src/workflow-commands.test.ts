import { describe, expect, it } from 'vitest';

import { parseWorkflowCommands, redact } from './workflow-commands.js';

describe('parseWorkflowCommands', () => {
  it('sorts annotations into their channels', () => {
    const commands = parseWorkflowCommands(
      ['::error::broke', '::warning::odd', '::notice::fyi', '::debug::detail', 'plain log line'].join('\n'),
    );

    expect(commands.errors).toEqual(['broke']);
    expect(commands.warnings).toEqual(['odd']);
    expect(commands.notices).toEqual(['fyi']);
    expect(commands.debug).toEqual(['detail']);
  });

  it('ignores the annotation properties and keeps the message', () => {
    expect(parseWorkflowCommands('::error file=src/a.ts,line=3::broke').errors).toEqual(['broke']);
  });

  it('decodes an escaped multiline message', () => {
    expect(parseWorkflowCommands('::error::first%0Asecond%25done').errors).toEqual(['first\nsecond%done']);
  });

  it('collects masked values', () => {
    expect(parseWorkflowCommands('::add-mask::ghp_secret').masks).toEqual(['ghp_secret']);
  });

  it('reads commands out of a CRLF stream', () => {
    expect(parseWorkflowCommands('::error::broke\r\n::warning::odd\r\n').errors).toEqual(['broke']);
  });
});

describe('redact', () => {
  it('replaces every occurrence of a masked value', () => {
    expect(redact('token=abc and again abc', ['abc'])).toBe('token=*** and again ***');
  });

  it('masks the longest value first, so no tail of a secret survives', () => {
    expect(redact('abcdef', ['abc', 'abcdef'])).toBe('***');
  });

  it('ignores an empty mask rather than shredding the text', () => {
    expect(redact('unchanged', [''])).toBe('unchanged');
  });
});
