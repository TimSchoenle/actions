import { describe, expect, it } from 'vitest';

import { ManifestFieldMissingError, ManifestParseError } from '../errors.js';
import { readCargoManifest } from './cargo.js';

const MINIMAL = `[package]\nname = "portfolio-platform"\nversion = "2.7.1"\n`;

describe('readCargoManifest', () => {
  it('reads the fields a README quotes', () => {
    const facts = readCargoManifest(
      `[package]
name = "terrace-config"
version = "0.9.0"
description = "Layered figment configuration that survives mounted-secret rotation."
license = "MIT"
homepage = "https://docs.rs/terrace-config"
rust-version = "1.94"
edition = "2021"
`,
      'Cargo.toml',
    );

    expect(facts).toEqual({
      kind: 'cargo',
      name: 'terrace-config',
      version: '0.9.0',
      description: 'Layered figment configuration that survives mounted-secret rotation.',
      license: 'MIT',
      homepage: 'https://docs.rs/terrace-config',
      toolchain: { msrv: '1.94', edition: '2021' },
    });
  });

  it('omits fields the manifest does not carry rather than emitting them empty', () => {
    const facts = readCargoManifest(MINIMAL, 'Cargo.toml');

    expect(facts.description).toBeUndefined();
    expect(facts.license).toBeUndefined();
    expect(facts.homepage).toBeUndefined();
    expect(facts.toolchain).toEqual({});
  });

  // The case the shallow parse exists to get right: a dependency's version never starts a line.
  it('does not read a version out of a dependency inline table', () => {
    const facts = readCargoManifest(
      `[package]
name = "portfolio-platform"
version = "2.7.1"

[dependencies]
figment = { version = "0.10", features = ["toml"] }
secrecy = "0.10"
`,
      'Cargo.toml',
    );

    expect(facts.version).toBe('2.7.1');
  });

  it('stops reading at the next table header', () => {
    const facts = readCargoManifest(
      `[package]
name = "web"
version = "1.0.0"

[workspace.package]
version = "9.9.9"
license = "Apache-2.0"
`,
      'Cargo.toml',
    );

    expect(facts.version).toBe('1.0.0');
    expect(facts.license).toBeUndefined();
  });

  it('reads a [package] table that does not come first', () => {
    const facts = readCargoManifest(
      `[workspace]\nmembers = ["crates/*"]\n\n[package]\nname = "root"\nversion = "3.1.4"\n`,
      'Cargo.toml',
    );

    expect(facts.version).toBe('3.1.4');
  });

  it('tolerates comments and surrounding whitespace', () => {
    const facts = readCargoManifest(
      `  [ package ]  # the package\n  version = "1.2.3"   # bumped by release-please\n`,
      'Cargo.toml',
    );

    expect(facts.version).toBe('1.2.3');
  });

  it('unescapes the basic-string escapes a description can carry', () => {
    const facts = readCargoManifest(
      `[package]\nversion = "1.0.0"\ndescription = "A \\"quoted\\" name, a back\\\\slash"\n`,
      'Cargo.toml',
    );

    expect(facts.description).toBe('A "quoted" name, a back\\slash');
  });

  it('keeps the first of a duplicated key, so the parse is deterministic', () => {
    expect(readCargoManifest(`[package]\nversion = "1.0.0"\nversion = "2.0.0"\n`, 'Cargo.toml').version).toBe('1.0.0');
  });

  it('refuses a virtual workspace manifest, naming what to do instead', () => {
    expect(() => readCargoManifest(`[workspace]\nmembers = ["crates/*"]\n`, 'Cargo.toml')).toThrow(ManifestParseError);
    expect(() => readCargoManifest(`[workspace]\n`, 'Cargo.toml')).toThrow(/point `manifest` at a member/);
  });

  it('explains an inherited version rather than reporting a bare absence', () => {
    const read = () => readCargoManifest(`[package]\nname = "web"\nversion.workspace = true\n`, 'Cargo.toml');

    expect(read).toThrow(ManifestFieldMissingError);
    expect(read).toThrow(/version\.workspace = true/);
  });

  it('reports a missing version with the path in the message', () => {
    expect(() => readCargoManifest(`[package]\nname = "web"\n`, 'apps/web/Cargo.toml')).toThrow(
      /^apps\/web\/Cargo\.toml: no 'package\.version'\.$/,
    );
  });
});
