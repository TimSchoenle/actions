import { accessSync, constants } from 'node:fs';
import path from 'node:path';

/** How the action under test is executed. */
export type ActionRuntime = 'node' | 'bun';

/** Raised when the interpreter a run needs is not installed. */
export class RuntimeNotFoundError extends Error {
  constructor(runtime: ActionRuntime) {
    super(
      `Cannot run the action: '${runtime}' was not found on PATH and is not the current interpreter. ` +
        (runtime === 'node'
          ? 'GitHub executes node20 actions with node, so the harness will not silently substitute another runtime.'
          : 'Running an action from TypeScript source requires bun.'),
    );
    this.name = 'RuntimeNotFoundError';
  }
}

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds an interpreter on PATH.
 *
 * Written out rather than shelling out to `which`/`where`: a spawn per lookup is slower than the
 * scan, and the two tools disagree about exit codes and quoting across platforms.
 */
function findOnPath(command: string): string | undefined {
  const extensions = process.platform === 'win32' ? (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';') : [''];

  for (const directory of (process.env['PATH'] ?? '').split(path.delimiter)) {
    if (directory === '') {
      continue;
    }

    for (const extension of extensions) {
      const candidate = path.join(directory, command + extension);

      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function isCurrentInterpreter(runtime: ActionRuntime): boolean {
  const runningBun = process.versions['bun'] !== undefined;

  return runtime === 'bun' ? runningBun : !runningBun;
}

/**
 * Resolves the executable for a runtime, preferring the interpreter already running this process.
 *
 * The distinction matters: a node20 action is a node bundle, and running it under bun would test a
 * runtime GitHub never uses. So the resolution never falls back across runtimes — it fails instead.
 */
export function resolveRuntime(runtime: ActionRuntime): string {
  if (isCurrentInterpreter(runtime)) {
    return process.execPath;
  }

  const found = findOnPath(runtime);

  if (found === undefined) {
    throw new RuntimeNotFoundError(runtime);
  }

  return found;
}
