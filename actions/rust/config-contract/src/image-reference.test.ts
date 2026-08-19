import { describe, expect, it } from 'vitest';

import { InvalidInputError } from './errors.js';
import { parseImageReference } from './image-reference.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;

/** Written by code point, so the fixture is visible in a diff rather than an invisible byte. */
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x20_0b);

describe('parseImageReference', () => {
  it.each([
    { name: 'a bare repository', value: 'api', expected: { name: 'api', tag: undefined, digest: undefined } },
    { name: 'a tagged image', value: 'myservice:test', expected: { name: 'myservice', tag: 'test' } },
    { name: 'a namespaced image', value: 'acme/api:v1.2.3', expected: { name: 'acme/api', tag: 'v1.2.3' } },
    {
      name: 'a registry host',
      value: 'ghcr.io/acme/api:sha-abc',
      expected: { name: 'ghcr.io/acme/api', tag: 'sha-abc' },
    },
    { name: 'a host with a port', value: 'localhost:5000/api:v1', expected: { name: 'localhost:5000/api', tag: 'v1' } },
    { name: 'a digest alone', value: `api@${DIGEST}`, expected: { name: 'api', tag: undefined, digest: DIGEST } },
    { name: 'a tag and a digest', value: `api:v1@${DIGEST}`, expected: { name: 'api', tag: 'v1', digest: DIGEST } },
  ])('accepts $name', ({ value, expected }) => {
    expect(parseImageReference(value)).toMatchObject({ reference: value, ...expected });
  });

  // The colon in `localhost:5000/api` is a port and the colon in `api:v1` is a tag, and only their
  // position relative to the last separator tells them apart. Getting it backwards makes `5000/api`
  // a tag, which passes a naive tag pattern and then fails against a registry.
  it('reads a port as part of the host, not as a tag', () => {
    expect(parseImageReference('registry.internal:8443/team/api')).toMatchObject({
      name: 'registry.internal:8443/team/api',
      tag: undefined,
    });
  });

  it.each([
    { name: 'an empty reference', value: '' },
    { name: 'a leading dash, which docker reads as a flag', value: '-v' },
    { name: 'a flag-shaped reference', value: '--rm' },
    { name: 'an embedded space', value: 'api latest' },
    { name: 'a newline', value: 'api\nlatest' },
    { name: 'a zero-width space', value: `api${ZERO_WIDTH_SPACE}v1` },
    { name: 'a shell metacharacter', value: 'api;rm -rf /' },
    { name: 'a command substitution', value: 'api$(whoami)' },
    { name: 'an empty tag', value: 'api:' },
    { name: 'a tag opening with a dot', value: 'api:.v1' },
    { name: 'an oversized tag', value: `api:${'v'.repeat(200)}` },
    { name: 'a truncated digest', value: 'api@sha256:abc' },
    { name: 'an unknown digest algorithm', value: `api@md5:${'a'.repeat(64)}` },
    { name: 'an empty path component', value: 'acme//api' },
    { name: 'a traversal in the path', value: 'acme/../api' },
    { name: 'a port on a path component', value: 'acme/api:8080/x' },
  ])('refuses $name', ({ value }) => {
    expect(() => parseImageReference(value)).toThrow(InvalidInputError);
  });

  it('refuses a reference past the length limit', () => {
    expect(() => parseImageReference(`a${'b'.repeat(600)}`)).toThrow(/past the 512-character limit/);
  });

  it('names the input it rejected, so a workflow with several paths knows which one to fix', () => {
    expect(() => parseImageReference('-v')).toThrow(/^image: /);
  });

  it('trims surrounding whitespace, which the runner would have trimmed anyway', () => {
    expect(parseImageReference('  api:v1  ').reference).toBe('api:v1');
  });
});
