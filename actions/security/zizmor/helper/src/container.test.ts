import { describe, expect, it } from 'vitest';

import { csvField, describeExit, dockerArguments, LineRelay, relayLine } from './container.js';

const IMAGE = `ghcr.io/zizmorcore/zizmor:1.30.1@sha256:${'a'.repeat(64)}`;

describe('dockerArguments', () => {
  it('starts a read-only, unprivileged container with the workspace mounted read-only', () => {
    expect(
      dockerArguments({ image: IMAGE, workspace: '/home/runner/work/r/r', zizmorArguments: ['--', '.'], online: true }),
    ).toEqual([
      'run',
      '--rm',
      '--read-only',
      '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=256m',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--user=65534:65534',
      '--mount=type=bind,source=/home/runner/work/r/r,target=/workspace,readonly',
      '--workdir=/workspace',
      '--env=GH_TOKEN',
      IMAGE,
      '--',
      '.',
    ]);
  });

  it('gives an offline run no network and no token', () => {
    const args = dockerArguments({ image: IMAGE, workspace: '/w', zizmorArguments: [], online: false });

    expect(args).toContain('--network=none');
    expect(args.join(' ')).not.toContain('GH_TOKEN');
  });

  it('quotes a workspace path that would otherwise end the mount field early', () => {
    const args = dockerArguments({
      image: IMAGE,
      workspace: '/w/a,readonly=false',
      zizmorArguments: [],
      online: false,
    });

    expect(args).toContain('--mount=type=bind,"source=/w/a,readonly=false",target=/workspace,readonly');
  });
});

describe('csvField', () => {
  it.each([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['a"b', '"a""b"'],
    ['a\nb', '"a\nb"'],
  ])('%j becomes %j', (field, expected) => {
    expect(csvField(field)).toBe(expected);
  });
});

describe('relayLine', () => {
  it('prefixes a visible character, so the runner never sees :: at the start', () => {
    expect(relayLine('::error::forged')).toBe('| ::error::forged');
    expect(relayLine('   ::add-mask::x').trimStart().startsWith('::')).toBe(false);
  });

  it('escapes control characters and keeps tabs', () => {
    expect(relayLine('a\u001B[31mb\tc\u2028d\u0085')).toBe('| a\\u001b[31mb\tc\\u2028d\\u0085');
  });
});

describe('LineRelay', () => {
  function relayed(chunks: readonly string[]): string[] {
    const lines: string[] = [];
    const relay = new LineRelay((line) => lines.push(line));

    for (const chunk of chunks) {
      relay.push(chunk);
    }

    relay.flush();

    return lines;
  }

  it('splits on \\n, \\r\\n and a lone \\r, as the runner does', () => {
    expect(relayed(['a\nb\r\nc\r::error::x\n'])).toEqual(['| a', '| b', '| c', '| ::error::x']);
  });

  it('joins a line split across chunks', () => {
    expect(relayed(['WARN fail', 'ed to parse\n'])).toEqual(['| WARN failed to parse']);
  });

  it('does not invent an empty line when \\r\\n is split across chunks', () => {
    expect(relayed(['a\r', '\nb'])).toEqual(['| a', '| b']);
  });

  it('treats a \\r at the very end as a line break', () => {
    expect(relayed(['a\r'])).toEqual(['| a']);
  });

  it('flushes a last line without a break, and nothing for an empty stream', () => {
    expect(relayed(['tail'])).toEqual(['| tail']);
    expect(relayed([])).toEqual([]);
  });
});

describe('describeExit', () => {
  it.each([
    [1, 'could not load an input'],
    [2, 'rejected its arguments'],
    [3, 'collected no inputs'],
    [125, 'ghcr.io:443'],
    [127, 'could not be run'],
    [14, 'zizmor exited with 14.'],
  ])('explains %i', (code, expected) => {
    expect(describeExit(code)).toContain(expected);
  });
});
