import { describe, expect, it } from 'vitest';

import { ManifestFieldMissingError, ManifestParseError } from '../errors.js';
import { readNpmManifest } from './npm.js';

describe('readNpmManifest', () => {
  it('reads the fields a README quotes', () => {
    const facts = readNpmManifest(
      JSON.stringify({
        name: 'actions-common-render-template',
        version: '1.1.1',
        description: 'Render a template file',
        license: 'MIT',
        homepage: 'https://github.com/TimSchoenle/actions',
        engines: { node: '>=20' },
      }),
      'package.json',
    );

    expect(facts).toEqual({
      kind: 'npm',
      name: 'actions-common-render-template',
      version: '1.1.1',
      description: 'Render a template file',
      license: 'MIT',
      homepage: 'https://github.com/TimSchoenle/actions',
      toolchain: { node: '>=20' },
    });
  });

  it('omits an engines entry the manifest does not declare', () => {
    expect(readNpmManifest(JSON.stringify({ version: '1.0.0' }), 'package.json').toolchain).toEqual({});
  });

  // A legacy `license: { type, url }` would otherwise render as `[object Object]`.
  it('omits a non-string field rather than stringifying it', () => {
    const facts = readNpmManifest(
      JSON.stringify({ version: '1.0.0', license: { type: 'MIT' }, description: 42 }),
      'package.json',
    );

    expect(facts.license).toBeUndefined();
    expect(facts.description).toBeUndefined();
  });

  it('refuses a file that is not JSON', () => {
    expect(() => readNpmManifest('{ not json', 'package.json')).toThrow(ManifestParseError);
  });

  it.each([
    ['an array', '[]'],
    ['a bare string', '"nope"'],
    ['null', 'null'],
  ])('refuses %s at the top level', (_label, source) => {
    expect(() => readNpmManifest(source, 'package.json')).toThrow(/the top level is not a JSON object/);
  });

  it('refuses a version that is not a string', () => {
    expect(() => readNpmManifest(JSON.stringify({ version: 2 }), 'package.json')).toThrow(ManifestFieldMissingError);
  });
});
