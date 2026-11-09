import { parse } from 'yaml';

/** One entry of an action's `inputs:` map. */
export interface ActionInput {
  name: string;
  description: string;
  required: boolean;
  /** The default as written in `action.yaml`, or `undefined` when there is none. */
  default: string | undefined;
}

/** One entry of an action's `outputs:` map. */
export interface ActionOutput {
  name: string;
  description: string;
}

/** The parts of an `action.yaml` its README is generated from. */
export interface ActionManifest {
  name: string;
  description: string;
  /** `runs.using`, e.g. `composite` or `node24`. */
  runtime: string;
  inputs: ActionInput[];
  outputs: ActionOutput[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a scalar the way GitHub does: `true`, `1` and `'x'` all reach the action as strings. */
function scalarText(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function entries(value: unknown, file: string, key: string): [string, Record<string, unknown>][] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!isRecord(value)) {
    throw new Error(`${file}: '${key}' must be a map`);
  }
  return Object.entries(value).map(([name, entry]) => {
    if (entry === null) {
      return [name, {}];
    }
    if (!isRecord(entry)) {
      throw new Error(`${file}: ${key}.${name} must be a map`);
    }
    return [name, entry];
  });
}

/**
 * Parses the documentation-relevant parts of an `action.yaml`.
 *
 * Throws on a file that is not a valid action manifest, since a README generated from a guess is
 * worse than a failed run. Input and output order is kept as written: authors order them on purpose.
 */
export function parseActionManifest(content: string, file: string): ActionManifest {
  const document: unknown = parse(content);
  if (!isRecord(document)) {
    throw new Error(`${file}: expected a YAML map`);
  }

  const name = scalarText(document.name);
  if (!name) {
    throw new Error(`${file}: 'name' is missing`);
  }

  const runs = document.runs;
  const runtime = isRecord(runs) ? scalarText(runs.using) : undefined;
  if (!runtime) {
    throw new Error(`${file}: 'runs.using' is missing`);
  }

  return {
    name,
    description: scalarText(document.description) ?? '',
    runtime,
    inputs: entries(document.inputs, file, 'inputs').map(([inputName, entry]) => ({
      name: inputName,
      description: scalarText(entry.description) ?? '',
      required: entry.required === true || entry.required === 'true',
      default: scalarText(entry.default),
    })),
    outputs: entries(document.outputs, file, 'outputs').map(([outputName, entry]) => ({
      name: outputName,
      description: scalarText(entry.description) ?? '',
    })),
  };
}
