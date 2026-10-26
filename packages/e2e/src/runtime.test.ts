import { afterEach, describe, expect, it, vi } from 'vitest';

import path from 'node:path';

import { NodeVersionMismatchError } from './node-version.js';
import { resolveRuntime, RuntimeNotFoundError } from './runtime.js';

describe('resolveRuntime', () => {
  it('checks a node run against the runtime its manifest declares', () => {
    const readMajor = vi.fn(() => 22);
    const resolve = (): string => resolveRuntime('node', { declaredRuntime: 'node24', readMajor });

    expect(resolve).toThrow(NodeVersionMismatchError);
    expect(readMajor).toHaveBeenCalledWith(resolveRuntime('node'));
  });

  it('returns the node when it is the declared major', () => {
    expect(resolveRuntime('node', { declaredRuntime: 'node24', readMajor: () => 24 })).toBe(resolveRuntime('node'));
  });

  it('checks nothing when no runtime is declared', () => {
    const readMajor = vi.fn(() => 22);

    resolveRuntime('node', { readMajor });

    expect(readMajor).not.toHaveBeenCalled();
  });

  it('never checks a bun run against a node runtime', () => {
    const readMajor = vi.fn(() => 22);

    expect(() => resolveRuntime('bun', { declaredRuntime: 'node24', readMajor })).not.toThrow(NodeVersionMismatchError);
    expect(readMajor).not.toHaveBeenCalled();
  });

  describe('with nothing usable on PATH', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('fails for the runtime that is not running this process, before checking any version', () => {
      const other = process.versions['bun'] === undefined ? 'bun' : 'node';
      const readMajor = vi.fn(() => 24);
      vi.stubEnv('PATH', `${path.delimiter}/nonexistent`);

      const resolve = (): string => resolveRuntime(other, { declaredRuntime: 'node24', readMajor });

      expect(resolve).toThrow(RuntimeNotFoundError);
      expect(resolve).toThrow(`'${other}' was not found on PATH`);
      expect(readMajor).not.toHaveBeenCalled();
    });
  });
});
