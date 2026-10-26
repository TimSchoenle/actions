import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatHumanReadableResult,
  formatJsonResult,
  main,
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

  // Not reachable through the CLI, which only redacts with an output directory, but the function
  // must still not invent a path.
  it('reports no location when redacting without an output directory', () => {
    const parsed = JSON.parse(formatJsonResult(material, undefined, false)) as Record<string, unknown>;

    expect(parsed['secretsWrittenTo']).toBeNull();
    expect(formatHumanReadableResult(material, undefined, false)).toContain('(none)');
  });
});

// End to end through main(), with a real Ed25519 key and no keyserver traffic: what reaches stdout
// is compared against the secrets the run wrote to disk.
describe('main', () => {
  const BASE_ARGS = ['--non-interactive', '--skip-publish', '--algo', 'ed25519', '--passphrase-bytes', '16'];
  let outputDir: string;
  let stdout: string[];

  beforeEach(async () => {
    outputDir = await mkdtemp(path.join(os.tmpdir(), 'signing-key-'));
    stdout = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      stdout.push(args.map(String).join(' '));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    await rm(outputDir, { force: true, recursive: true });
  });

  async function writtenSecrets(): Promise<string[]> {
    const credentials = JSON.parse(await readFile(path.join(outputDir, 'credentials.json'), 'utf8')) as {
      passphrase: string;
      privateKey: string;
    };
    return [credentials.passphrase, credentials.privateKey.trim()];
  }

  it.each([
    ['human-readable', []],
    ['--json', ['--json']],
  ])('keeps the secrets off stdout with --output-dir (%s)', async (_format, extra) => {
    await main([...BASE_ARGS, '--output-dir', outputDir, ...extra]);

    expect(process.exitCode).toBeUndefined();
    const output = stdout.join('\n');
    for (const secret of await writtenSecrets()) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain(path.resolve(outputDir));
  });

  it('prints the secrets with --output-dir when --print-secrets is given', async () => {
    await main([...BASE_ARGS, '--output-dir', outputDir, '--json', '--print-secrets']);

    expect(process.exitCode).toBeUndefined();
    const printed = JSON.parse(stdout.join('\n')) as { passphrase: string; privateKey: string };
    expect([printed.passphrase, printed.privateKey.trim()]).toEqual(await writtenSecrets());
  });

  it('prints the secrets without an output directory, where stdout is the only copy', async () => {
    await main([...BASE_ARGS, '--json']);

    expect(process.exitCode).toBeUndefined();
    const printed = JSON.parse(stdout.join('\n')) as { passphrase?: string; privateKey?: string };
    expect(printed.passphrase).toMatch(/\S/);
    expect(printed.privateKey).toContain('PRIVATE KEY BLOCK');
  });
});
