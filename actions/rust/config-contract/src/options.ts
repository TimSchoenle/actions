/**
 * The action's inputs, resolved and validated before anything is read, run or inspected.
 *
 * Everything here is refused up front rather than passed through, and for two different reasons.
 * The path inputs decide which files are opened, so they are confined to the checkout. The rest
 * become arguments to `cargo` and `docker`, so they are confined to the grammars those tools
 * document — a feature list is a feature list, not an opportunity to add a flag.
 *
 * The whole set is resolved in one pass so a workflow with three bad inputs is told about the first
 * one it can act on rather than discovering them one failed run at a time.
 */
import path from 'node:path';

import { resolveWithinWorkspace } from 'actions-util';

import { InvalidInputError } from './errors.js';
import { parseImageReference } from './image-reference.js';

import type { ImageReference } from './image-reference.js';

/** Cargo's name grammar for an example target or a workspace member. */
const CARGO_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;

/**
 * Cargo's feature-name grammar.
 *
 * Wider than {@link CARGO_NAME} by `+` and `.`, which appear in the `dep:`-free spellings cargo
 * accepts, and deliberately no wider: a feature carrying a space would arrive at cargo as a second
 * argument, which is the whole reason this is validated rather than interpolated.
 */
const CARGO_FEATURE = /^[A-Za-z0-9_][A-Za-z0-9_+.-]{0,63}$/;

/** Separators a workflow author might reasonably use between features. */
const FEATURE_SEPARATOR = /[\s,]+/;

/** Most features one generator can plausibly need; past this the input is a mistake, not a list. */
const MAX_FEATURES = 32;

/** Longest path accepted inside the image, matching the limit every mainstream filesystem imposes. */
const MAX_EMBEDDED_PATH_LENGTH = 4096;

/** Segments that would make an in-image path mean something other than where it points. */
const RELATIVE_SEGMENTS = new Set(['', '.', '..']);

/** The action inputs as the runner delivers them, before any of them mean anything. */
export interface RawInputs {
  readonly source_directory: string;
  readonly example: string;
  readonly package: string;
  readonly features: string;
  readonly dockerfile: string;
  readonly contract: string;
  readonly image: string;
  readonly contract_path: string;
}

/** A path input that may be omitted, kept alongside the spelling the caller used. */
export interface OptionalPath {
  /** The value exactly as the workflow wrote it, which is what every message quotes. */
  readonly input: string;
  /** The absolute path it resolves to. */
  readonly absolute: string;
  /**
   * The same path relative to the workspace, in POSIX form.
   *
   * What a GitHub annotation has to carry: an annotation is anchored by a repository-relative path,
   * so a project in a subdirectory needs the `source_directory` prefix that the input itself omits.
   */
  readonly workspaceRelative: string;
}

/** Everything the checks need, with every input already known to be usable. */
export interface ContractOptions {
  /** Absolute directory the generator runs in, and the root the two file inputs resolve against. */
  readonly sourceDirectory: string;
  readonly example: string;
  /** The `-p` argument, or `undefined` for the root package. */
  readonly packageName: string | undefined;
  /** Features in the order given, deduplicated. Empty when none were requested. */
  readonly features: readonly string[];
  /** The Dockerfile whose marked region is checked, or `undefined` when that check is skipped. */
  readonly dockerfile: OptionalPath | undefined;
  /** The committed contract document, or `undefined` when that check is skipped. */
  readonly contract: OptionalPath | undefined;
  /** The image to inspect, or `undefined` when both image checks are skipped. */
  readonly image: ImageReference | undefined;
  /** Absolute path the contract is expected at inside the image. */
  readonly embeddedContractPath: string;
}

function parseCargoName(value: string, input: string): string {
  if (!CARGO_NAME.test(value)) {
    throw new InvalidInputError(
      input,
      `'${value}' is not a cargo target name. Expected a letter, digit or underscore followed by up to 63 of [A-Za-z0-9_-].`,
    );
  }

  return value;
}

/** Splits, validates and deduplicates the feature list, preserving the order it was written in. */
export function parseFeatures(value: string): string[] {
  const trimmed = value.trim();

  if (trimmed === '') {
    return [];
  }

  const features: string[] = [];

  for (const feature of trimmed.split(FEATURE_SEPARATOR)) {
    if (!CARGO_FEATURE.test(feature)) {
      throw new InvalidInputError('features', `'${feature}' is not a cargo feature name.`);
    }

    if (!features.includes(feature)) {
      features.push(feature);
    }
  }

  if (features.length > MAX_FEATURES) {
    throw new InvalidInputError('features', `lists ${features.length} features, past the limit of ${MAX_FEATURES}.`);
  }

  return features;
}

/**
 * Validates the path the contract is expected at inside the image.
 *
 * Absolute and fully resolved, because it is compared against a `COPY` destination and handed to
 * `docker cp`: a relative path would be resolved against the image's working directory, which this
 * action cannot see, and a `..` segment would make the label advertise one location and the check
 * read another.
 */
export function parseEmbeddedContractPath(value: string): string {
  if (!value.startsWith('/')) {
    throw new InvalidInputError('contract_path', `'${value}' is not absolute. It is a path inside the image.`);
  }

  if (value.length > MAX_EMBEDDED_PATH_LENGTH) {
    throw new InvalidInputError('contract_path', `is ${value.length} characters, past the filesystem limit.`);
  }

  const segments = value.slice(1).split('/');

  if (segments.some((segment) => RELATIVE_SEGMENTS.has(segment))) {
    throw new InvalidInputError(
      'contract_path',
      `'${value}' must name a file directly: no empty, '.' or '..' segments.`,
    );
  }

  return value;
}

/** Resolves an optional path input beneath the source directory, or reports it as absent. */
function optionalPath(value: string, root: string, workspace: string, input: string): OptionalPath | undefined {
  if (value === '') {
    return undefined;
  }

  const absolute = resolveWithinWorkspace(value, root, input);

  return { input: value, absolute, workspaceRelative: path.relative(workspace, absolute).split(path.sep).join('/') };
}

/**
 * Turns the raw inputs into the options the checks run against.
 *
 * `dockerfile`, `contract` and `image` are each skipped by emptying them, which is what lets a
 * repository with no image, or no committed contract, take only the half that applies to it. Nothing
 * else is optional: a generator that is not named cannot be run, and a check that cannot run is not
 * a check that passed.
 *
 * @throws {InvalidInputError} for a value outside the grammar of the tool it is passed to.
 * @throws {UnsafePathError} for a path input that escapes the workspace.
 */
export function resolveOptions(raw: RawInputs, workspace: string): ContractOptions {
  const sourceDirectory = resolveWithinWorkspace(raw.source_directory, workspace, 'source_directory');

  return {
    sourceDirectory,
    example: parseCargoName(raw.example, 'example'),
    packageName: raw.package === '' ? undefined : parseCargoName(raw.package, 'package'),
    features: parseFeatures(raw.features),
    dockerfile: optionalPath(raw.dockerfile, sourceDirectory, workspace, 'dockerfile'),
    contract: optionalPath(raw.contract, sourceDirectory, workspace, 'contract'),
    image: raw.image === '' ? undefined : parseImageReference(raw.image),
    embeddedContractPath: parseEmbeddedContractPath(raw.contract_path),
  };
}
