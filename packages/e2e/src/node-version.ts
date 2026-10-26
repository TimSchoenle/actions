import { execFileSync } from 'node:child_process';

/**
 * Declared runtimes whose Node major the harness enforces, mapped to that major.
 *
 * `node20` is left out on purpose. Only the composites' helper manifests still declare it, and in
 * production a composite runs its helper bundle with whatever `node` is on the runner's PATH, so
 * that declaration never selects a runtime. Enforcing it here would test a guarantee GitHub does
 * not give. A JavaScript action's `node24`, by contrast, is the exact major the runner executes it
 * with, so an end-to-end run under any other major would test a runtime the action never meets.
 */
const ENFORCED_MAJORS: ReadonlyMap<string, number> = new Map([['node24', 24]]);

/** The Node major a declared runtime requires, or `undefined` when the harness does not enforce it. */
export function requiredNodeMajor(declaredRuntime: string): number | undefined {
  return ENFORCED_MAJORS.get(declaredRuntime);
}

/** Raised when the `node` that would run an action is not the major its manifest declares. */
export class NodeVersionMismatchError extends Error {
  constructor(executable: string, declaredRuntime: string, required: number, actual: number) {
    super(
      `The action declares runs.using '${declaredRuntime}', but '${executable}' is Node ${actual}. ` +
        `Put Node ${required} first on PATH (for example with actions/setup-node), so the end-to-end ` +
        'run uses the runtime GitHub executes the action with.',
    );
    this.name = 'NodeVersionMismatchError';
  }
}

/** Raised when `<executable> --version` does not print a Node version. */
export class UnreadableNodeVersionError extends Error {
  constructor(executable: string, output: string) {
    super(`Cannot read the Node version of '${executable}': '--version' printed '${output.trim()}'.`);
    this.name = 'UnreadableNodeVersionError';
  }
}

/** Runs `<executable> --version` and returns what it printed. */
export type VersionQuery = (executable: string) => string;

/** Returns the Node major of an executable. */
export type NodeMajorReader = (executable: string) => number;

function queryVersion(executable: string): string {
  return execFileSync(executable, ['--version'], { encoding: 'utf8' });
}

/** Parses `node --version` output such as `v24.21.0` into its major. */
export function parseNodeMajor(executable: string, output: string): number {
  const match = /^v(\d+)\./.exec(output.trim());

  if (match === null) {
    throw new UnreadableNodeVersionError(executable, output);
  }

  return Number(match[1]);
}

/**
 * Builds a reader that asks each executable for its version once.
 *
 * A suite runs an action many times with the same `node`, and a spawn per run would only repeat an
 * answer that cannot change while the suite runs.
 */
export function createNodeMajorReader(query: VersionQuery = queryVersion): NodeMajorReader {
  const majors = new Map<string, number>();

  return (executable) => {
    const cached = majors.get(executable);

    if (cached !== undefined) {
      return cached;
    }

    const major = parseNodeMajor(executable, query(executable));
    majors.set(executable, major);

    return major;
  };
}

/** The process-wide reader, so every run in a suite shares one cache. */
export const readNodeMajor: NodeMajorReader = createNodeMajorReader();

/**
 * Fails when `executable` is not the Node major `declaredRuntime` requires.
 *
 * Does nothing, and spawns nothing, for a runtime {@link requiredNodeMajor} does not enforce.
 */
export function assertNodeMatchesDeclaredRuntime(
  executable: string,
  declaredRuntime: string,
  readMajor: NodeMajorReader = readNodeMajor,
): void {
  const required = requiredNodeMajor(declaredRuntime);

  if (required === undefined) {
    return;
  }

  const actual = readMajor(executable);

  if (actual !== required) {
    throw new NodeVersionMismatchError(executable, declaredRuntime, required, actual);
  }
}
