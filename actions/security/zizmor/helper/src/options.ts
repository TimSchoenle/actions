/**
 * Turns the raw composite inputs into the validated options zizmor is run with.
 *
 * Pure over strings, so every rule here is unit-tested without a runner. It runs before the image is
 * pulled, so a typo fails the step in a second. Whether a path exists is the business of
 * `input-paths.ts`, which needs the filesystem.
 *
 * Inputs are reported under the composite's kebab-case names, which is what the workflow author wrote.
 */
import { quoteForLog } from 'actions-util';

import { InvalidInputError } from './errors.js';

/** zizmor's personas, in the order its own help lists them from least to most noisy. */
export const PERSONAS = ['regular', 'pedantic', 'auditor'] as const;

export type Persona = (typeof PERSONAS)[number];

/** zizmor's severities, lowest first. The index is the rank the gate compares by. */
export const SEVERITIES = ['informational', 'low', 'medium', 'high'] as const;

export type Severity = (typeof SEVERITIES)[number];

/** zizmor's confidences, lowest first. */
export const CONFIDENCES = ['low', 'medium', 'high'] as const;

export type Confidence = (typeof CONFIDENCES)[number];

/** The lowest severity that fails the gate, or `none` to never fail on a finding. */
export type FailThreshold = Severity | 'none';

/** Every value `fail-on-severity` accepts. */
export const FAIL_THRESHOLDS: readonly FailThreshold[] = [...SEVERITIES, 'none'];

/**
 * A container image pinned by digest, with an optional tag kept for the reader.
 *
 * The image is set by the composite, never by a caller, so this guards against an edit to
 * `action.yaml` that drops the digest: a tag alone is a pointer the registry owner can move.
 */
const PINNED_IMAGE = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*(?::[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?@sha256:[a-f0-9]{64}$/;

/** The raw strings the composite hands to the scan, keyed by the composite's own input names. */
export interface RawScanInputs {
  readonly inputs: string;
  readonly persona: string;
  readonly onlineAudits: string;
  readonly minSeverity: string;
  readonly minConfidence: string;
  readonly config: string;
  readonly failOnSeverity: string;
  readonly strictCollection: string;
  readonly upload: string;
  readonly token: string;
  readonly image: string;
}

/** Everything the scan inputs mean, validated. Paths are as written; `input-paths.ts` resolves them. */
export interface ScanOptions {
  /** The `inputs` lines, trimmed, deduplicated and in the order given. */
  readonly inputs: readonly string[];
  readonly persona: Persona;
  readonly onlineAudits: boolean;
  readonly minSeverity: Severity | undefined;
  readonly minConfidence: Confidence | undefined;
  /** The `config` path as written, or undefined to let zizmor discover one. */
  readonly config: string | undefined;
  readonly failOnSeverity: FailThreshold;
  readonly strictCollection: boolean;
  readonly upload: boolean;
  /** Undefined when online audits are off, so the token never reaches the container without a use. */
  readonly token: string | undefined;
  readonly image: string;
}

/** Parses a boolean the way `core.getBooleanInput` does, under the composite's input name. */
export function parseBoolean(input: string, value: string): boolean {
  const trimmed = value.trim();

  if (['true', 'True', 'TRUE'].includes(trimmed)) {
    return true;
  }

  if (['false', 'False', 'FALSE'].includes(trimmed)) {
    return false;
  }

  throw new InvalidInputError(input, `${quoteForLog(trimmed)} is not a boolean. Expected true or false.`);
}

/**
 * Parses one value of a closed set, exactly as zizmor spells it.
 *
 * Case is not folded. zizmor's own parser rejects `High`, and accepting it here would only move the
 * failure from this step into the container.
 */
export function parseChoice<T extends string>(input: string, value: string, choices: readonly T[]): T {
  const trimmed = value.trim();

  if ((choices as readonly string[]).includes(trimmed)) {
    return trimmed as T;
  }

  throw new InvalidInputError(input, `${quoteForLog(trimmed)} is not one of ${choices.join(', ')}.`);
}

/** {@link parseChoice}, with an empty value meaning the option is not passed at all. */
function parseOptionalChoice<T extends string>(input: string, value: string, choices: readonly T[]): T | undefined {
  return value.trim() === '' ? undefined : parseChoice(input, value, choices);
}

/**
 * Parses the `inputs` input: one path per line.
 *
 * Blank lines and lines starting with `#` are skipped. A line starting with `-` is refused outright:
 * the paths are passed after `--`, but `-` alone still means standard input to zizmor, and a flag
 * that only works because of where it lands in the argument list is one refactor away from being a
 * flag. A path that really begins with a dash is written `./-name`.
 *
 * @throws {@link InvalidInputError} for a line starting with `-`, and when no path is left.
 */
export function parseInputLines(value: string): string[] {
  const paths: string[] = [];

  for (const line of value.split('\n')) {
    const path = line.trim();

    if (path === '' || path.startsWith('#')) {
      continue;
    }

    if (path.startsWith('-')) {
      throw new InvalidInputError(
        'inputs',
        `${quoteForLog(path)} starts with -, which zizmor would read as a flag or as standard input. ` +
          'Write a path that begins with a dash as ./-name.',
      );
    }

    if (!paths.includes(path)) {
      paths.push(path);
    }
  }

  if (paths.length === 0) {
    throw new InvalidInputError('inputs', 'names no path. Give at least one, such as ".".');
  }

  return paths;
}

/** Parses the internal image reference, which must carry a digest. */
export function parseImage(value: string): string {
  const image = value.trim();

  if (!PINNED_IMAGE.test(image)) {
    throw new InvalidInputError('image', `${quoteForLog(image)} is not an image reference pinned by sha256 digest.`);
  }

  return image;
}

/**
 * Resolves the token the container receives.
 *
 * zizmor given no token does not fail. It logs a warning and skips every online audit, so an empty
 * `token` with `online-audits: true` would pass while auditing less than the workflow says.
 */
function resolveToken(value: string, onlineAudits: boolean): string | undefined {
  if (!onlineAudits) {
    return undefined;
  }

  if (value.trim() === '') {
    throw new InvalidInputError(
      'token',
      'is empty, and zizmor skips every online audit without one. Pass a token or set online-audits: false.',
    );
  }

  return value;
}

/**
 * Validates every scan input.
 *
 * `fail-on-severity` is validated here as well as in the gate, so a typo in it fails before the image
 * is pulled instead of after a full run.
 *
 * @throws {@link InvalidInputError} naming the first input that is not usable.
 */
export function resolveScanOptions(raw: RawScanInputs): ScanOptions {
  const onlineAudits = parseBoolean('online-audits', raw.onlineAudits);
  const config = raw.config.trim();

  return {
    inputs: parseInputLines(raw.inputs),
    persona: parseChoice('persona', raw.persona, PERSONAS),
    onlineAudits,
    minSeverity: parseOptionalChoice('min-severity', raw.minSeverity, SEVERITIES),
    minConfidence: parseOptionalChoice('min-confidence', raw.minConfidence, CONFIDENCES),
    config: config === '' ? undefined : config,
    failOnSeverity: parseChoice('fail-on-severity', raw.failOnSeverity, FAIL_THRESHOLDS),
    strictCollection: parseBoolean('strict-collection', raw.strictCollection),
    upload: parseBoolean('upload', raw.upload),
    token: resolveToken(raw.token, onlineAudits),
    image: parseImage(raw.image),
  };
}

/** Container path zizmor writes its HTTP cache to: a tmpfs, because the root filesystem is read-only. */
export const CONTAINER_CACHE_DIRECTORY = '/tmp/zizmor';

/**
 * The arguments zizmor itself receives, after the image name.
 *
 * Each option is one `--name=value` argument, so no value can be read as a separate flag, and the
 * paths come after `--`. `--color=never` keeps escape sequences out of the step log, and the cache
 * directory points at the one writable mount.
 *
 * @param paths - the audit inputs as they are passed to zizmor, relative to `/workspace`.
 * @param config - the configuration file relative to `/workspace`, when one is given.
 */
export function zizmorArguments(options: ScanOptions, paths: readonly string[], config: string | undefined): string[] {
  const args = [
    `--persona=${options.persona}`,
    '--format=sarif',
    '--color=never',
    `--cache-dir=${CONTAINER_CACHE_DIRECTORY}`,
  ];

  if (options.strictCollection) {
    args.push('--strict-collection');
  }

  if (!options.onlineAudits) {
    args.push('--no-online-audits');
  }

  if (options.minSeverity !== undefined) {
    args.push(`--min-severity=${options.minSeverity}`);
  }

  if (options.minConfidence !== undefined) {
    args.push(`--min-confidence=${options.minConfidence}`);
  }

  if (config !== undefined) {
    args.push(`--config=${config}`);
  }

  args.push('--', ...paths);

  return args;
}
