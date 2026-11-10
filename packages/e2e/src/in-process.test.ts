import { appendFileSync } from 'node:fs';

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

  it('restores a variable it overrode', async () => {
    process.env['IN_PROCESS_PROBE'] = 'outer';
    await runInProcess({}, () => undefined, { IN_PROCESS_PROBE: 'inner' });

    expect(process.env['IN_PROCESS_PROBE']).toBe('outer');
    delete process.env['IN_PROCESS_PROBE'];
  });
});
