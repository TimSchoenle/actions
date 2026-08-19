import path from 'node:path';

import { UnsafePathError } from 'actions-util';
import { describe, expect, it } from 'vitest';

import { InvalidInputError } from './errors.js';
import { parseEmbeddedContractPath, parseFeatures, resolveOptions } from './options.js';

import type { RawInputs } from './options.js';

const WORKSPACE = path.resolve('/workspace');

const DEFAULTS: RawInputs = {
  source_directory: '.',
  example: 'config-schema',
  package: '',
  features: '',
  dockerfile: 'Dockerfile',
  contract: 'docs/config.contract.json',
  image: '',
  contract_path: '/config/contract.json',
};

function resolve(overrides: Partial<RawInputs> = {}) {
  return resolveOptions({ ...DEFAULTS, ...overrides }, WORKSPACE);
}

describe('parseFeatures', () => {
  it('reads an empty input as no features rather than as one empty feature', () => {
    expect(parseFeatures('')).toEqual([]);
    expect(parseFeatures('   ')).toEqual([]);
  });

  it.each([
    { name: 'a comma-separated list', value: 'a,b,c' },
    { name: 'a whitespace-separated list', value: 'a b c' },
    { name: 'a mixed list with padding', value: ' a , b,  c ' },
    { name: 'a newline-separated list', value: 'a\nb\nc' },
  ])('accepts $name', ({ value }) => {
    expect(parseFeatures(value)).toEqual(['a', 'b', 'c']);
  });

  it('preserves order and drops repeats, so the cargo argument is stable', () => {
    expect(parseFeatures('schema,cli,schema')).toEqual(['schema', 'cli']);
  });

  it('accepts the punctuation cargo feature names actually use', () => {
    expect(parseFeatures('config-schema,serde_json,tls+rustls,v1.2')).toHaveLength(4);
  });

  it.each([
    { name: 'a flag', value: '--offline' },
    { name: 'a shell metacharacter', value: 'a;b' },
    { name: 'a quote', value: `a"b` },
    { name: 'a path', value: '../evil' },
  ])('refuses $name, which would arrive at cargo as something other than a feature', ({ value }) => {
    expect(() => parseFeatures(value)).toThrow(InvalidInputError);
  });

  it('refuses a list past the limit rather than assembling a command line out of it', () => {
    const many = Array.from({ length: 40 }, (_, index) => `f${index}`).join(',');

    expect(() => parseFeatures(many)).toThrow(/past the limit of 32/);
  });
});

describe('parseEmbeddedContractPath', () => {
  it('accepts an absolute path inside the image', () => {
    expect(parseEmbeddedContractPath('/config/contract.json')).toBe('/config/contract.json');
  });

  it.each([
    { name: 'a relative path', value: 'config/contract.json' },
    { name: 'an empty path', value: '' },
    { name: 'a traversal', value: '/config/../etc/passwd' },
    { name: 'a dot segment', value: '/config/./contract.json' },
    { name: 'a trailing separator', value: '/config/' },
    { name: 'a doubled separator', value: '/config//contract.json' },
  ])('refuses $name', ({ value }) => {
    expect(() => parseEmbeddedContractPath(value)).toThrow(InvalidInputError);
  });

  it('refuses a path past the filesystem limit', () => {
    expect(() => parseEmbeddedContractPath(`/${'a'.repeat(5000)}`)).toThrow(/past the filesystem limit/);
  });
});

describe('resolveOptions', () => {
  it('resolves the defaults an unconfigured workflow gets', () => {
    const options = resolve();

    expect(options.sourceDirectory).toBe(WORKSPACE);
    expect(options.example).toBe('config-schema');
    expect(options.packageName).toBeUndefined();
    expect(options.features).toEqual([]);
    expect(options.image).toBeUndefined();
    expect(options.dockerfile?.absolute).toBe(path.join(WORKSPACE, 'Dockerfile'));
    expect(options.contract?.absolute).toBe(path.join(WORKSPACE, 'docs', 'config.contract.json'));
  });

  // The two file inputs are written relative to the project, the way they are in the repository that
  // owns them; an annotation is anchored relative to the repository. Without the prefix a monorepo
  // gets its annotations attached to a file at the wrong level, or to no file at all.
  it('anchors an annotation relative to the workspace, not to the source directory', () => {
    const options = resolve({ source_directory: 'services/api', dockerfile: 'docker/Dockerfile' });

    expect(options.dockerfile?.input).toBe('docker/Dockerfile');
    expect(options.dockerfile?.workspaceRelative).toBe('services/api/docker/Dockerfile');
  });

  it.each([
    { input: 'dockerfile' as const, id: 'dockerfile' },
    { input: 'contract' as const, id: 'contract' },
    { input: 'image' as const, id: 'image' },
  ])('treats an empty $input as a check that is not requested', ({ input }) => {
    expect(resolve({ [input]: '' })[input === 'image' ? 'image' : input]).toBeUndefined();
  });

  it('passes a workspace member through as the -p argument', () => {
    expect(resolve({ package: 'api-config' }).packageName).toBe('api-config');
  });

  it.each([
    { name: 'an example that is a flag', overrides: { example: '--manifest-path' } },
    { name: 'an example with a space', overrides: { example: 'config schema' } },
    { name: 'an empty example, which would run no generator', overrides: { example: '' } },
    { name: 'a package that is a flag', overrides: { package: '-Zunstable' } },
    { name: 'an image that is a flag', overrides: { image: '--privileged' } },
  ])('refuses $name', ({ overrides }) => {
    expect(() => resolve(overrides)).toThrow(InvalidInputError);
  });

  it.each([
    { name: 'a parent walk', value: '../../../etc' },
    { name: 'an absolute path', value: '/etc' },
    { name: 'a Windows absolute path', value: 'C:/Windows' },
    { name: 'a UNC path', value: '//host/share' },
  ])('refuses $name in source_directory', ({ value }) => {
    expect(() => resolve({ source_directory: value })).toThrow(UnsafePathError);
  });

  // Confined against the source directory, which is itself confined against the workspace — so a
  // Dockerfile that escapes the project cannot land back inside the checkout either.
  it.each([
    { name: 'a parent walk out of the project', value: '../../../../etc/passwd' },
    { name: 'an absolute path', value: '/etc/passwd' },
  ])('refuses $name in dockerfile', ({ value }) => {
    expect(() => resolve({ source_directory: 'services/api', dockerfile: value })).toThrow(UnsafePathError);
  });

  it('names the offending input, not the resolved path', () => {
    expect(() => resolve({ contract: '../../secret.json' })).toThrow(/^contract:? /);
  });
});
