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

  it('refuses a manifest with neither package table, naming what to do instead', () => {
    expect(() => readCargoManifest(`[workspace]\nmembers = ["crates/*"]\n`, 'Cargo.toml')).toThrow(ManifestParseError);
    expect(() => readCargoManifest(`[workspace]\n`, 'Cargo.toml')).toThrow(
      /no \[package\] or \[workspace\.package\] table/,
    );
  });

  it('reads a virtual workspace manifest from [workspace.package]', () => {
    const facts = readCargoManifest(
      `[workspace]
members = ["crates/*", "services/*"]

[workspace.package]
version = "11.1.1"
edition = "2024"
description = "Multi-service aggregator."
license = "PolyForm-Noncommercial-1.0.0"
rust-version = "1.94"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
`,
      'Cargo.toml',
    );

    expect(facts).toEqual({
      kind: 'cargo',
      name: undefined,
      version: '11.1.1',
      description: 'Multi-service aggregator.',
      license: 'PolyForm-Noncommercial-1.0.0',
      homepage: undefined,
      toolchain: { msrv: '1.94', edition: '2024' },
    });
  });

  it('reports a virtual workspace without a version under its own table name', () => {
    expect(() => readCargoManifest(`[workspace.package]\nedition = "2024"\n`, 'Cargo.toml')).toThrow(
      /^Cargo\.toml: no 'workspace\.package\.version'\.$/,
    );
  });

  it('resolves an inherited field from [workspace.package] in the same file', () => {
    const facts = readCargoManifest(
      `[workspace.package]
version = "4.0.0"
license = "MIT"
rust-version = "1.94"

[package]
name = "root"
version.workspace = true
license.workspace = true
rust-version.workspace = true
edition = "2024"
`,
      'Cargo.toml',
    );

    expect(facts.name).toBe('root');
    expect(facts.version).toBe('4.0.0');
    expect(facts.license).toBe('MIT');
    expect(facts.toolchain).toEqual({ msrv: '1.94', edition: '2024' });
  });

  it('resolves the inline-table form of an inherited field', () => {
    const facts = readCargoManifest(
      `[workspace.package]
version = "4.0.0"
edition = "2024"

[package]
name = "root"
version = { workspace = true }
edition = {workspace=true}
`,
      'Cargo.toml',
    );

    expect(facts.version).toBe('4.0.0');
    expect(facts.toolchain).toEqual({ edition: '2024' });
  });

  it('reads table headers and dotted keys with whitespace around the dot', () => {
    const facts = readCargoManifest(
      `[ workspace . package ]
version = "1.2.3"

[package]
name = "root"
version . workspace = true
`,
      'Cargo.toml',
    );

    expect(facts.version).toBe('1.2.3');
  });

  it('reads quoted keys and quoted header parts as their bare equivalents', () => {
    const facts = readCargoManifest(
      `["workspace".'package']
"version" = "5.0.0"
'edition' = "2024"

[package]
name = "root"
version = { "workspace" = true }
edition."workspace" = true
`,
      'Cargo.toml',
    );

    expect(facts.version).toBe('5.0.0');
    expect(facts.toolchain).toEqual({ edition: '2024' });
  });

  it('does not split a quoted key part at the dot it contains', () => {
    expect(() => readCargoManifest(`["workspace.package"]\nversion = "1.0.0"\n`, 'Cargo.toml')).toThrow(
      ManifestParseError,
    );
  });

  it('reads a literal-string value, which has no escapes', () => {
    expect(
      readCargoManifest(`[package]\nversion = "1.0.0"\ndescription = 'C:\\path'\n`, 'Cargo.toml').description,
    ).toBe('C:\\path');
  });

  it('never reads an assignment out of a multiline string', () => {
    const facts = readCargoManifest(
      `[workspace.package]
description = """
version = "9.9.9"
[package]
"""
notes = '''
version = "8.8.8"
'''
license = "MIT" # a """ inside a comment opens nothing
version = "1.2.3"
`,
      'Cargo.toml',
    );

    expect(facts.version).toBe('1.2.3');
    expect(facts.name).toBeUndefined();
    expect(facts.description).toBeUndefined();
    expect(facts.license).toBe('MIT');
  });

  it('closes a multiline basic string only on an unescaped delimiter, with up to two extra quotes', () => {
    const facts = readCargoManifest(
      `[package]
description = """
an escaped \\""" stays open
version = "9.9.9"
ends here"""""
version = "1.2.3"
homepage = "https://example.com/\\"\\"\\"" # a single-line string with quotes opens nothing
name = "after"
`,
      'Cargo.toml',
    );

    expect(facts.version).toBe('1.2.3');
    expect(facts.name).toBe('after');
  });

  it('skips lines it cannot read rather than guessing at them', () => {
    const facts = readCargoManifest(
      `[workspace.package]
edition = "2024"

[package]
name = "kept"
version = "1.0.0"
a-bare-word
bad key = "x"
a..b = "x"
a.b.c = "x"
repository = 'unterminated
description = "ends in a backslash \\
license = { workspace = true
homepage = 'https://example.com'
[unclosed
keywords = """one line""" # opens and closes on this line
edition = "2021"
edition.workspace = true
`,
      'Cargo.toml',
    );

    expect(facts.name).toBe('kept');
    expect(facts.version).toBe('1.0.0');
    expect(facts.description).toBeUndefined();
    expect(facts.license).toBeUndefined();
    expect(facts.homepage).toBe('https://example.com');
    expect(facts.toolchain).toEqual({ edition: '2021' });
  });

  it('never reports a name from [workspace.package], which cannot carry one', () => {
    expect(
      readCargoManifest(`[workspace.package]\nname = "x"\nversion = "1.0.0"\n`, 'Cargo.toml').name,
    ).toBeUndefined();
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
