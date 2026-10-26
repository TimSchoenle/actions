import { describe, expect, it, vi } from 'vitest';

import {
  assertNodeMatchesDeclaredRuntime,
  createNodeMajorReader,
  NodeVersionMismatchError,
  parseNodeMajor,
  readNodeMajor,
  requiredNodeMajor,
  UnreadableNodeVersionError,
} from './node-version.js';
import { resolveRuntime } from './runtime.js';

const NODE = '/opt/hostedtoolcache/node/bin/node';

describe('requiredNodeMajor', () => {
  it('requires Node 24 for a node24 manifest', () => {
    expect(requiredNodeMajor('node24')).toBe(24);
  });

  it.each(['node20', 'node16', 'composite', ''])('enforces nothing for %j', (declared) => {
    expect(requiredNodeMajor(declared)).toBeUndefined();
  });
});

describe('parseNodeMajor', () => {
  it.each([
    ['v24.21.0\n', 24],
    ['v22.23.3', 22],
    ['  v20.0.0  ', 20],
  ])('reads the major of %j', (output, major) => {
    expect(parseNodeMajor(NODE, output)).toBe(major);
  });

  it.each(['1.3.2', '', 'node v24.1.0', 'v24'])('refuses %j, naming the executable', (output) => {
    const parse = (): unknown => parseNodeMajor(NODE, output);

    expect(parse).toThrow(UnreadableNodeVersionError);
    expect(parse).toThrow(NODE);
  });
});

describe('createNodeMajorReader', () => {
  it('asks each executable for its version once', () => {
    const query = vi.fn((executable: string) => (executable === NODE ? 'v24.21.0\n' : 'v22.23.3\n'));
    const read = createNodeMajorReader(query);

    expect(read(NODE)).toBe(24);
    expect(read(NODE)).toBe(24);
    expect(read('/usr/bin/node')).toBe(22);
    expect(read('/usr/bin/node')).toBe(22);

    expect(query.mock.calls).toEqual([[NODE], ['/usr/bin/node']]);
  });

  it('caches nothing for an executable whose version cannot be read', () => {
    const query = vi.fn().mockReturnValueOnce('garbage').mockReturnValueOnce('v24.0.0');
    const read = createNodeMajorReader(query);

    expect(() => read(NODE)).toThrow(UnreadableNodeVersionError);
    expect(read(NODE)).toBe(24);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reads a real node by running it', () => {
    const node = resolveRuntime('node');

    expect(readNodeMajor(node)).toBeGreaterThanOrEqual(20);
  });
});

describe('assertNodeMatchesDeclaredRuntime', () => {
  it('passes a node24 manifest on Node 24', () => {
    expect(() => assertNodeMatchesDeclaredRuntime(NODE, 'node24', () => 24)).not.toThrow();
  });

  it('refuses a node24 manifest on another major, naming both', () => {
    const assert = (): void => assertNodeMatchesDeclaredRuntime(NODE, 'node24', () => 22);

    expect(assert).toThrow(NodeVersionMismatchError);
    expect(assert).toThrow(`runs.using 'node24', but '${NODE}' is Node 22. Put Node 24 first on PATH`);
  });

  it('never asks the version of a node20 manifest, which the harness does not enforce', () => {
    const readMajor = vi.fn(() => 22);

    assertNodeMatchesDeclaredRuntime(NODE, 'node20', readMajor);

    expect(readMajor).not.toHaveBeenCalled();
  });

  it('reads the version through the shared reader by default', () => {
    const node = resolveRuntime('node');
    const thrown = ((): unknown => {
      try {
        assertNodeMatchesDeclaredRuntime(node, 'node24');
        return undefined;
      } catch (error) {
        return error;
      }
    })();

    expect(thrown).toEqual(readNodeMajor(node) === 24 ? undefined : expect.any(NodeVersionMismatchError));
  });
});
