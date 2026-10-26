import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  formatHumanReadableResult,
  formatJsonResult,
  parseArgs,
  redactSecrets,
  shouldPrintSecrets,
  type SigningKeyMaterial,
} from '../generate-maven-central-signing-key.js';

// The generator's secrets must reach stdout only when stdout is the caller's sole copy of them, or
// when the caller asks for it. These tests pin that rule for both output formats, using sentinel
// strings that would be unmistakable anywhere in the output.

const PASSPHRASE = 'SENTINEL-PASSPHRASE';
const PRIVATE_KEY = '-----BEGIN PGP PRIVATE KEY BLOCK-----\nSENTINEL-PRIVATE\n-----END PGP PRIVATE KEY BLOCK-----\n';
const REVOCATION = '-----BEGIN PGP PUBLIC KEY BLOCK-----\nSENTINEL-REVOCATION\n-----END PGP PUBLIC KEY BLOCK-----\n';
const PUBLIC_KEY = '-----BEGIN PGP PUBLIC KEY BLOCK-----\nSENTINEL-PUBLIC\n-----END PGP PUBLIC KEY BLOCK-----\n';
const SECRETS = [PASSPHRASE, 'SENTINEL-PRIVATE', 'SENTINEL-REVOCATION'];

const material: SigningKeyMaterial = {
  createdAt: '2026-01-01T00:00:00.000Z',
  email: 'signer@example.invalid',
  fingerprint: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
  keyId: '89ABCDEF01234567',
  name: 'Signer',
  passphrase: PASSPHRASE,
  privateKey: PRIVATE_KEY,
  publicationResults: [],
  publicKey: PUBLIC_KEY,
  revocationCertificate: REVOCATION,
  uid: 'Signer <signer@example.invalid>',
};

function expectNoSecrets(output: string): void {
  for (const secret of SECRETS) {
    expect(output).not.toContain(secret);
  }
}

function expectAllSecrets(output: string): void {
  for (const secret of SECRETS) {
    expect(output).toContain(secret);
  }
}

describe('parseArgs', () => {
  it('defaults to not forcing the secrets onto stdout', () => {
    expect(parseArgs([]).printSecrets).toBe(false);
  });

  it('reads --print-secrets as a flag', () => {
    const options = parseArgs(['--output-dir', 'out', '--print-secrets', '--json']);

    expect(options.printSecrets).toBe(true);
    expect(options.outputDir).toBe('out');
    expect(options.json).toBe(true);
  });

  it('rejects a value after --print-secrets as an unknown argument', () => {
    expect(() => parseArgs(['--print-secrets', 'yes'])).toThrow(/Unknown argument: yes/);
  });
});

describe('shouldPrintSecrets', () => {
  it('prints them when no output directory holds a copy', () => {
    expect(shouldPrintSecrets({ outputDir: undefined, printSecrets: false })).toBe(true);
  });

  it('keeps them off stdout when an output directory holds a copy', () => {
    expect(shouldPrintSecrets({ outputDir: 'out', printSecrets: false })).toBe(false);
  });

  it('prints them with an output directory only when asked to', () => {
    expect(shouldPrintSecrets({ outputDir: 'out', printSecrets: true })).toBe(true);
  });
});

describe('redactSecrets', () => {
  it('keeps the public fields and drops every secret one', () => {
    const redacted = redactSecrets(material);

    expect(Object.keys(redacted).sort()).toEqual([
      'createdAt',
      'email',
      'fingerprint',
      'keyId',
      'name',
      'publicKey',
      'publicationResults',
      'uid',
    ]);
    expectNoSecrets(JSON.stringify(redacted));
  });
});

describe('formatHumanReadableResult', () => {
  it('includes every secret when printing is allowed', () => {
    const output = formatHumanReadableResult(material, undefined, true);

    expectAllSecrets(output);
    expect(output).toContain('SENTINEL-PUBLIC');
  });

  it('omits every secret and names where they were written otherwise', () => {
    const output = formatHumanReadableResult(material, 'out', false);

    expectNoSecrets(output);
    expect(output).toContain('SENTINEL-PUBLIC');
    expect(output).toContain(path.resolve('out'));
    expect(output).toContain('--print-secrets');
  });
});

describe('formatJsonResult', () => {
  it('emits the full material when printing is allowed', () => {
    const parsed = JSON.parse(formatJsonResult(material, undefined, true)) as SigningKeyMaterial;

    expect(parsed).toEqual(material);
  });

  it('emits the redacted material and the output directory otherwise', () => {
    const output = formatJsonResult(material, 'out', false);
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expectNoSecrets(output);
    expect(parsed['publicKey']).toBe(PUBLIC_KEY);
    expect(parsed['secretsRedacted']).toBe(true);
    expect(parsed['secretsWrittenTo']).toBe(path.resolve('out'));
  });
});
