import * as core from '@actions/core';

/**
 * The `@actions/core` I/O surface of one action, narrowed to the names its `action.yaml` declares.
 *
 * `TInput` and `TOutput` are the unions generated from the manifest, so reading an input or writing
 * an output the action does not declare is a compile error rather than a value the runner silently
 * hands back as `''`.
 */
export interface ActionIo<TInput extends string, TOutput extends string> {
  getBooleanInput(name: TInput, options?: core.InputOptions): boolean;
  getInput(name: TInput, options?: core.InputOptions): string;
  getMultilineInput(name: TInput, options?: core.InputOptions): string[];
  setOutput(name: TOutput, value: string): void;
}

/**
 * Binds `@actions/core` to the declared names of a single action.
 *
 * Every input stays a `string`: that is what the runner hands over, and inferring a type from an
 * input's default would silently take over validation that belongs to `@actions/core`, which already
 * rejects anything outside the YAML 1.2 core schema.
 *
 * The generated module per action is what supplies the name unions; this holds the calls themselves,
 * which are identical in every action and were previously emitted ten times over.
 */
export function createActionIo<TInput extends string, TOutput extends string>(): ActionIo<TInput, TOutput> {
  return {
    getBooleanInput: (name, options) => core.getBooleanInput(name, options),
    getInput: (name, options) => core.getInput(name, options),
    getMultilineInput: (name, options) => core.getMultilineInput(name, options),
    setOutput: (name, value) => {
      core.setOutput(name, value);
    },
  };
}
