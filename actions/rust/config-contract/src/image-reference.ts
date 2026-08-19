/**
 * Validation of the `image` input, which is the one input that becomes an argument to `docker`.
 *
 * A workflow is free to pass `${{ github.event.inputs.image }}` here, so the value is untrusted, and
 * it reaches an argument vector rather than a file path — a reference beginning with `-` is read by
 * `docker` as a flag, not as an image. Parsing it against the reference grammar rather than pattern
 * matching the whole string keeps the rejection specific ("the tag is not a tag") and keeps every
 * quantifier bounded, so no input can make the validation itself the slow part of the step.
 */
import { InvalidInputError } from './errors.js';

/** Longest reference accepted, comfortably past a registry host plus a namespaced repository. */
const MAX_REFERENCE_LENGTH = 512;

/** One `/`-separated component of the repository path, and the host when there is one. */
const PATH_COMPONENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** A host may additionally carry a port, which no other component may. */
const PORT = /^\d{1,5}$/;

/** Docker's tag grammar: a word character, then up to 127 more of a slightly wider set. */
const TAG = /^\w[\w.-]{0,127}$/;

/** A content digest, restricted to the algorithms a registry actually serves. */
const DIGEST = /^sha(256|512):[0-9a-f]{64,128}$/;

/**
 * Whitespace, the control blocks and the invisible formatting characters.
 *
 * `\p{Cf}` is the half worth naming: a zero-width space or a bidi override inside a reference makes
 * two visibly identical tags that are not the same tag, and a log line is where that is discovered.
 */
const NOT_PRINTABLE = /[\s\p{Cc}\p{Cf}]/u;

/** An image reference, split into the parts `docker` reads separately. */
export interface ImageReference {
  /** The reference exactly as given, which is what is passed to `docker`. */
  readonly reference: string;
  /** Everything before the tag and digest, e.g. `ghcr.io/acme/api`. */
  readonly name: string;
  readonly tag: string | undefined;
  readonly digest: string | undefined;
}

/** Whether a name component looks like a registry host rather than a repository segment. */
function isHost(component: string): boolean {
  return component.includes(':') || component.includes('.') || component === 'localhost';
}

/**
 * Whether a host component is well formed, port included.
 *
 * Split rather than matched as one pattern: a single expression covering both halves nests an
 * optional group inside an unbounded one, which is the shape a backtracking engine can be made to
 * work at, and which no reader can confirm is safe by looking at it.
 */
function isValidHost(component: string): boolean {
  const [host, port, ...rest] = component.split(':');

  return rest.length === 0 && PATH_COMPONENT.test(host) && (port === undefined || PORT.test(port));
}

function reject(reason: string): never {
  throw new InvalidInputError('image', reason);
}

function splitDigest(value: string): { rest: string; digest: string | undefined } {
  const at = value.lastIndexOf('@');

  if (at === -1) {
    return { rest: value, digest: undefined };
  }

  const digest = value.slice(at + 1);

  if (!DIGEST.test(digest)) {
    reject(`'${digest}' is not a content digest. Expected sha256: or sha512: followed by lowercase hex.`);
  }

  return { rest: value.slice(0, at), digest };
}

/**
 * Splits the tag off, using only a colon that follows the last `/`.
 *
 * The colon in `localhost:5000/api` is a port and the colon in `api:v1` is a tag, and nothing but
 * their position relative to the final separator tells them apart.
 */
function splitTag(value: string): { name: string; tag: string | undefined } {
  const colon = value.lastIndexOf(':');

  if (colon === -1 || colon < value.lastIndexOf('/')) {
    return { name: value, tag: undefined };
  }

  const tag = value.slice(colon + 1);

  if (!TAG.test(tag)) {
    reject(`'${tag}' is not a tag. Expected a word character followed by up to 127 of [A-Za-z0-9_.-].`);
  }

  return { name: value.slice(0, colon), tag };
}

function assertName(name: string): void {
  if (name === '') {
    reject('the reference names no image.');
  }

  const components = name.split('/');

  for (const [index, component] of components.entries()) {
    const isRegistryHost = index === 0 && components.length > 1 && isHost(component);
    const valid = isRegistryHost ? isValidHost(component) : PATH_COMPONENT.test(component);

    if (!valid) {
      reject(`'${component}' is not a usable part of an image reference.`);
    }
  }
}

/**
 * Parses and validates an image reference, refusing anything `docker` would read as something else.
 *
 * @throws {InvalidInputError} for an empty, oversized or malformed reference.
 */
export function parseImageReference(value: string): ImageReference {
  const reference = value.trim();

  if (reference === '') {
    reject('must not be empty.');
  }

  if (reference.length > MAX_REFERENCE_LENGTH) {
    reject(`is ${reference.length} characters, past the ${MAX_REFERENCE_LENGTH}-character limit.`);
  }

  // Checked before the grammar so a control character is reported as itself rather than as a
  // component that merely failed to match, which is the same verdict and a worse explanation.
  if (NOT_PRINTABLE.test(reference)) {
    reject('must not contain whitespace, control or invisible formatting characters.');
  }

  const { rest, digest } = splitDigest(reference);
  const { name, tag } = splitTag(rest);

  assertName(name);

  return { reference, name, tag, digest };
}
