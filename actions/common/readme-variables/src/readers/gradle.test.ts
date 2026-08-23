import { describe, expect, it } from 'vitest';

import { ManifestFieldMissingError } from '../errors.js';
import { parseProperties, readGradleManifest } from './gradle.js';

describe('parseProperties', () => {
  it.each([
    ['=', 'version=1.0.0'],
    [':', 'version:1.0.0'],
    ['a space', 'version 1.0.0'],
  ])('accepts %s as the separator', (_label, line) => {
    expect(parseProperties(line).get('version')).toBe('1.0.0');
  });

  it.each([
    ['a hash comment', '# version=9.9.9\nversion=1.0.0'],
    ['a bang comment', '! version=9.9.9\nversion=1.0.0'],
    ['a blank line', '\n\nversion=1.0.0\n'],
  ])('ignores %s', (_label, source) => {
    expect(parseProperties(source).get('version')).toBe('1.0.0');
  });

  it('joins a backslash continuation, dropping the leading whitespace of the next line', () => {
    expect(parseProperties('description=a long \\\n    description').get('description')).toBe('a long description');
  });

  it('treats an escaped backslash at the end of a value as a value, not a continuation', () => {
    expect(parseProperties('path=C:\\\\dir\\\\\nversion=1.0.0').get('version')).toBe('1.0.0');
  });

  it('unescapes a separator inside a key', () => {
    expect(parseProperties('java\\.version=21').get('java.version')).toBe('21');
  });

  it('keeps the first of a duplicated key', () => {
    expect(parseProperties('version=1.0.0\nversion=2.0.0').get('version')).toBe('1.0.0');
  });

  it('trims trailing whitespace from a value but keeps inner spacing', () => {
    expect(parseProperties('description=two  words   ').get('description')).toBe('two  words');
  });
});

describe('readGradleManifest', () => {
  it('reads the fields a README quotes', () => {
    const facts = readGradleManifest(
      `group=de.timscho
artifactId=gradle-jextract
version=1.4.0
description=A Gradle plugin that automates jextract
javaVersion=21
gradleVersion=8.14
`,
      'gradle.properties',
    );

    expect(facts).toEqual({
      kind: 'gradle',
      name: 'de.timscho:gradle-jextract',
      version: '1.4.0',
      description: 'A Gradle plugin that automates jextract',
      toolchain: { jdk: '21', gradle: '8.14' },
    });
  });

  it('falls back to the artifact alone when no group is declared', () => {
    expect(readGradleManifest(`name=recipes\nversion=1.0.0\n`, 'gradle.properties').name).toBe('recipes');
  });

  it('leaves the name undefined when neither spelling is declared', () => {
    expect(readGradleManifest(`version=1.0.0\n`, 'gradle.properties').name).toBeUndefined();
  });

  it('takes the first jdk spelling it finds, so both aliases cannot disagree', () => {
    expect(readGradleManifest(`version=1.0.0\njavaVersion=21\njdkVersion=17\n`, 'gradle.properties').toolchain).toEqual(
      { jdk: '21' },
    );
  });

  it.each([
    ['no version at all', 'group=de.timscho\n'],
    ['an empty version', 'version=\n'],
  ])('refuses %s, naming what to do instead', (_label, source) => {
    const read = () => readGradleManifest(source, 'gradle.properties');

    expect(read).toThrow(ManifestFieldMissingError);
    expect(read).toThrow(/write it to gradle\.properties/);
  });
});
