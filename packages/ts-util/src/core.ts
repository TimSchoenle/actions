/**
 * The runner interface actions use: inputs, outputs, the step log, annotations, masking, the job
 * summary and the exit code. Imported as `actions-util/core`, as a namespace (`core.info`).
 *
 * Actions import the runner interface from here rather than from `@actions/core`, so the library
 * behind it can be replaced without touching any action.
 *
 * @packageDocumentation
 */
export {
  addPath,
  debug,
  endGroup,
  error,
  ExitCode,
  getBooleanInput,
  getInput,
  getMultilineInput,
  info,
  notice,
  setFailed,
  setOutput,
  setSecret,
  startGroup,
  summary,
  warning,
} from '@actions/core';
export type { AnnotationProperties, InputOptions } from '@actions/core';
