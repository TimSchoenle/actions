import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'yaml';

/** The runtime an action declares under `runs.using`; only `node20` can be driven by this harness. */
export const SUPPORTED_RUNTIME = 'node20';

/** One entry of an action's `inputs:` block, reduced to what the harness needs to build the env. */
export interface ActionInputDeclaration {
  name: string;
  required: boolean;
  /** The `default:` from `action.yaml`, applied by the runner when the caller supplies no value. */
  default?: string;
}

/** An `action.yaml` reduced to the contract the harness has to honour. */
export interface ActionManifest {
  /** Directory the manifest was read from; every relative path in it resolves against this. */
  directory: string;
  name: string;
  inputs: ReadonlyMap<string, ActionInputDeclaration>;
  outputs: ReadonlySet<string>;
  using: string;
  /** `runs.main`, relative to {@link directory}. */
  main: string;
}

/** Raised when an `action.yaml` cannot be driven by the harness, with the reason stated. */
export class UnsupportedActionError extends Error {
  constructor(directory: string, reason: string) {
    super(`Cannot run '${directory}' end-to-end: ${reason}`);
    this.name = 'UnsupportedActionError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Reads an input's `default:` as the runner would.
 *
 * YAML types the value, so `default: false` parses as a boolean and `default: 0` as a number, while
 * the runner hands every input over as a string. Stringifying here reproduces that, rather than
 * leaking a non-string into the environment where it would fail differently than in a real job.
 */
function readDefault(declaration: Record<string, unknown>): string | undefined {
  const value = declaration['default'];

  return value === undefined || value === null ? undefined : String(value);
}

function parseInputs(runs: Record<string, unknown> | undefined): Map<string, ActionInputDeclaration> {
  const inputs = new Map<string, ActionInputDeclaration>();

  for (const [name, raw] of Object.entries(runs ?? {})) {
    const declaration = asRecord(raw) ?? {};

    inputs.set(name, {
      name,
      required: declaration['required'] === true,
      default: readDefault(declaration),
    });
  }

  return inputs;
}

/**
 * Parses an `action.yaml` into the contract the harness drives.
 *
 * Deliberately strict about `runs`: an action whose runtime is not {@link SUPPORTED_RUNTIME} cannot
 * be invoked as a subprocess at all, and failing here names the reason instead of surfacing a
 * confusing "cannot find module" from the spawn.
 */
export function parseActionManifest(source: string, directory: string): ActionManifest {
  const document = asRecord(parse(source));

  if (!document) {
    throw new UnsupportedActionError(directory, 'action.yaml is not a mapping');
  }

  const runs = asRecord(document['runs']);
  const using = typeof runs?.['using'] === 'string' ? runs['using'] : undefined;
  const main = typeof runs?.['main'] === 'string' ? runs['main'] : undefined;

  if (using !== SUPPORTED_RUNTIME) {
    throw new UnsupportedActionError(
      directory,
      `runs.using is '${using ?? 'undeclared'}', and only '${SUPPORTED_RUNTIME}' actions run as a subprocess. ` +
        'Composite actions still need a workflow.',
    );
  }

  if (!main) {
    throw new UnsupportedActionError(directory, 'runs.main is not declared');
  }

  return {
    directory,
    name: typeof document['name'] === 'string' ? document['name'] : path.basename(directory),
    inputs: parseInputs(asRecord(document['inputs'])),
    outputs: new Set(Object.keys(asRecord(document['outputs']) ?? {})),
    using,
    main,
  };
}

/** Loads the `action.yaml` sitting in `directory`. */
export async function loadActionManifest(directory: string): Promise<ActionManifest> {
  const manifestPath = path.join(directory, 'action.yaml');
  const source = await readFile(manifestPath, 'utf8');

  return parseActionManifest(source, directory);
}
