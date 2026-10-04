/**
 * Validation of the `image` input, which becomes an argument to both `docker` and `trivy`.
 *
 * A workflow is free to pass `${{ github.event.inputs.image }}` here, so the value is untrusted, and
 * it reaches an argument vector rather than a file path — a reference beginning with `-` is read by
 * either tool as a flag, not as an image. Parsing it against the reference grammar keeps the
 * rejection specific and keeps every quantifier bounded.
 *
 * Mirrors `actions/rust/config-contract/src/image-reference.ts`. Kept per action, as `body.ts` is
 * between `upsert-pr-comment` and `upsert-issue`: promoting it to `actions-util` would rewrite the
 * bytes of every committed bundle for a module only two actions use.
 */
import { InvalidInputError } from './errors.js';

const INPUT = 'image';

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

/** Whitespace, the control blocks and the invisible formatting characters. */
const NOT_PRINTABLE = /[\s\p{Cc}\p{Cf}]/u;

function reject(reason: string): never {
  throw new InvalidInputError(INPUT, reason);
}

function isHost(component: string): boolean {
  return component.includes(':') || component.includes('.') || component === 'localhost';
}

/** Split rather than matched as one pattern, so no nested quantifier can backtrack. */
function isValidHost(component: string): boolean {
  const [host, port, ...rest] = component.split(':');

  return rest.length === 0 && PATH_COMPONENT.test(host) && (port === undefined || PORT.test(port));
}

function stripDigest(value: string): string {
  const at = value.lastIndexOf('@');

  if (at === -1) {
    return value;
  }

  const digest = value.slice(at + 1);

  if (!DIGEST.test(digest)) {
    reject(`'${digest}' is not a content digest. Expected sha256: or sha512: followed by lowercase hex.`);
  }

  return value.slice(0, at);
}

/** Splits the tag off using only a colon after the last `/`: `localhost:5000/api` has a port. */
function stripTag(value: string): string {
  const colon = value.lastIndexOf(':');

  if (colon === -1 || colon < value.lastIndexOf('/')) {
    return value;
  }

  const tag = value.slice(colon + 1);

  if (!TAG.test(tag)) {
    reject(`'${tag}' is not a tag. Expected a word character followed by up to 127 of [A-Za-z0-9_.-].`);
  }

  return value.slice(0, colon);
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
 * Validates an image reference and returns it trimmed, refusing anything a tool would misread.
 *
 * @throws {InvalidInputError} for an empty, oversized or malformed reference.
 */
export function parseImageReference(value: string): string {
  const reference = value.trim();

  if (reference === '') {
    reject('is required.');
  }

  if (reference.length > MAX_REFERENCE_LENGTH) {
    reject(`is ${reference.length} characters, past the ${MAX_REFERENCE_LENGTH}-character limit.`);
  }

  // Before the grammar, so a control character is reported as itself.
  if (NOT_PRINTABLE.test(reference)) {
    reject('must not contain whitespace, control or invisible formatting characters.');
  }

  assertName(stripTag(stripDigest(reference)));

  return reference;
}
