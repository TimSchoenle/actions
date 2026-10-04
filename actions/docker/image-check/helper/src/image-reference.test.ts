import { describe, expect, it } from 'vitest';

import { InvalidInputError } from './errors.js';
import { parseImageReference } from './image-reference.js';

describe('parseImageReference', () => {
  it.each([
    'app:test',
    'image:test-arm64',
    'ghcr.io/acme/app:1.0.0',
    'localhost:5000/app',
    'localhost:5000/app:v1',
    `app@sha256:${'a'.repeat(64)}`,
    `ghcr.io/acme/app:1.0@sha256:${'b'.repeat(64)}`,
  ])('accepts %j', (reference) => {
    expect(parseImageReference(reference)).toBe(reference);
  });

  it.each([
    ['a flag', '--output=/etc/passwd'],
    ['a leading dash in a component', 'acme/-app'],
    ['whitespace', 'app test'],
    ['a zero-width space', 'app​:test'],
    ['an empty tag', 'app:'],
    ['a malformed digest', 'app@sha256:xyz'],
    ['a bad port', 'localhost:99999999/app'],
    ['an oversized reference', `a${'b'.repeat(512)}`],
    ['nothing but a tag', ':tag'],
  ])('rejects %s', (_case, reference) => {
    expect(() => parseImageReference(reference)).toThrow(InvalidInputError);
  });
});
