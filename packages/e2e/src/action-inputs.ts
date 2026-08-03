import type { ActionManifest } from './action-manifest.js';

/**
 * The environment variable `@actions/core.getInput` reads for an input.
 *
 * Mirrors `@actions/core` exactly — uppercase, spaces to underscores, and nothing else. Notably a
 * hyphen is *not* translated, so `app-id` is read from `INPUT_APP-ID`; normalising it here would
 * make the harness pass inputs the real runner never delivers.
 */
export function inputEnvName(inputName: string): string {
  return `INPUT_${inputName.replaceAll(' ', '_').toUpperCase()}`;
}

/** Raised when the inputs a case supplies do not match the action's declared contract. */
export class InputContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputContractError';
  }
}

/**
 * A value of `undefined` for a declared input means "deliberately omit it", which is how a case
 * exercises an action's own required-input handling. An absent key instead falls back to the
 * manifest default.
 */
export type ProvidedInputs<TInput extends string> = Partial<Record<TInput, string | undefined>>;

function assertNoUnknownInputs(manifest: ActionManifest, provided: ProvidedInputs<string>): void {
  const unknown = Object.keys(provided).filter((name) => !manifest.inputs.has(name));

  if (unknown.length > 0) {
    const declared = [...manifest.inputs.keys()].sort().join(', ');

    throw new InputContractError(
      `Input(s) not declared in ${manifest.directory}/action.yaml: ${unknown.sort().join(', ')}. Declared: ${declared}.`,
    );
  }
}

/**
 * Guards the case where two declared inputs map onto one environment variable.
 *
 * `@actions/core`'s mapping is lossy — `a b`, `a_b` and `A_B` all become `INPUT_A_B` — so an action
 * declaring such a pair silently makes one input unreachable. That is a defect in the action, and it
 * is worth failing its tests loudly rather than letting the second value quietly win.
 */
function assertNoEnvCollisions(manifest: ActionManifest): void {
  const seen = new Map<string, string>();

  for (const name of manifest.inputs.keys()) {
    const variable = inputEnvName(name);
    const previous = seen.get(variable);

    if (previous !== undefined) {
      throw new InputContractError(
        `Inputs '${previous}' and '${name}' of ${manifest.directory}/action.yaml both map to ${variable}.`,
      );
    }

    seen.set(variable, name);
  }
}

/**
 * Builds the `INPUT_*` environment the runner would hand the action.
 *
 * Applying the manifest's own defaults here is what makes the harness test the `action.yaml`
 * contract rather than just the TypeScript behind it: renaming an input, or changing a default,
 * changes what the action under test receives and fails the case.
 */
export function resolveInputEnv<TInput extends string>(
  manifest: ActionManifest,
  provided: ProvidedInputs<TInput> = {},
): Record<string, string> {
  assertNoEnvCollisions(manifest);
  assertNoUnknownInputs(manifest, provided);

  const env: Record<string, string> = {};
  const missing: string[] = [];

  for (const declaration of manifest.inputs.values()) {
    const omitted = declaration.name in provided && provided[declaration.name as TInput] === undefined;

    if (omitted) {
      continue;
    }

    const value = provided[declaration.name as TInput] ?? declaration.default;

    if (value === undefined) {
      if (declaration.required) {
        missing.push(declaration.name);
      }
      continue;
    }

    env[inputEnvName(declaration.name)] = value;
  }

  if (missing.length > 0) {
    throw new InputContractError(
      `Required input(s) of ${manifest.directory}/action.yaml not supplied: ${missing.sort().join(', ')}. ` +
        'Pass `undefined` explicitly to omit one on purpose.',
    );
  }

  return env;
}
