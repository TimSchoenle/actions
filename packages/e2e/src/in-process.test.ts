import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runInProcess } from './in-process.js';

describe('runInProcess', () => {
  it('passes inputs as INPUT_ variables and reads outputs back from GITHUB_OUTPUT', async () => {
    const result = await runInProcess({ 'my-input': 'value', 'two words': 'x' }, () => {
      appendFileSync(
        process.env['GITHUB_OUTPUT'] as string,
        `echo<<EOF\n${process.env['INPUT_MY-INPUT']}|${process.env['INPUT_TWO_WORDS']}\nEOF\n`,
      );
      process.stdout.write('::warning::careful\n');
    });

    expect(result.outputs).toEqual({ echo: 'value|x' });
    expect(result.warnings).toEqual(['careful']);
    expect(result.exitCode).toBe(0);
    expect(process.env['INPUT_MY-INPUT']).toBeUndefined();
  });

  it('reports the exit code a failed step sets, then restores it', async () => {
    const before = process.exitCode;
    const result = await runInProcess({}, () => {
      process.exitCode = 1;
    });

    expect(result.exitCode).toBe(1);
    expect(process.exitCode).toBe(before);
  });

  it('returns the variables the body exported through GITHUB_ENV', async () => {
    const result = await runInProcess({}, () => {
      appendFileSync(process.env['GITHUB_ENV'] as string, 'EXPORTED<<EOF\nvalue\nEOF\n');
    });

    expect(result.exportedEnv).toEqual({ EXPORTED: 'value' });
  });

  it('calls back a write that passes a callback, with or without an encoding', async () => {
    const result = await runInProcess({}, async () => {
      await new Promise<void>((resolve) => process.stdout.write('one\n', () => resolve()));
      await new Promise<void>((resolve) => process.stdout.write('two\n', 'utf8', () => resolve()));
    });

    expect(result.stdout).toBe('one\ntwo\n');
  });

  it('keeps a multi-byte character that arrives split across two writes', async () => {
    const euro = Buffer.from('€\n', 'utf8');
    const result = await runInProcess({}, () => {
      process.stdout.write(euro.subarray(0, 1));
      process.stdout.write(euro.subarray(1));
    });

    expect(result.stdout).toBe('€\n');
  });

  it('puts back the original stdout write after a run', async () => {
    const before = process.stdout.write;
    const hadOwnWrite = Object.hasOwn(process.stdout, 'write');
    await runInProcess({}, () => {
      process.stdout.write('captured\n');
    });

    expect(process.stdout.write).toBe(before);
    expect(Object.hasOwn(process.stdout, 'write')).toBe(hadOwnWrite);
  });

  it('propagates an error the body throws and still restores everything', async () => {
    const before = process.stdout.write;
    const outer = { output: process.env['GITHUB_OUTPUT'], env: process.env['GITHUB_ENV'], exitCode: process.exitCode };
    // One variable unset and one set beforehand, so both ways of restoring are exercised.
    delete process.env['GITHUB_OUTPUT'];
    process.env['GITHUB_ENV'] = 'outer-env-file';
    process.exitCode = 0;
    let outputFile = '';

    try {
      await expect(
        runInProcess({ probe: 'x' }, () => {
          outputFile = process.env['GITHUB_OUTPUT'] as string;
          process.exitCode = 1;
          throw new Error('body failed');
        }),
      ).rejects.toThrow('body failed');

      expect(process.stdout.write).toBe(before);
      expect(process.env['INPUT_PROBE']).toBeUndefined();
      expect(process.env['GITHUB_OUTPUT']).toBeUndefined();
      expect(process.env['GITHUB_ENV']).toBe('outer-env-file');
      expect(process.exitCode).toBe(0);
      expect(outputFile).not.toBe('');
      expect(existsSync(path.dirname(outputFile))).toBe(false);
    } finally {
      for (const [key, value] of [
        ['GITHUB_OUTPUT', outer.output],
        ['GITHUB_ENV', outer.env],
      ] as const) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      process.exitCode = outer.exitCode;
    }
  });

  it('restores a variable it overrode', async () => {
    process.env['IN_PROCESS_PROBE'] = 'outer';
    await runInProcess({}, () => undefined, { IN_PROCESS_PROBE: 'inner' });

    expect(process.env['IN_PROCESS_PROBE']).toBe('outer');
    delete process.env['IN_PROCESS_PROBE'];
  });
});
