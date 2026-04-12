import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { input, select } from '@inquirer/prompts';

type Algorithm = 'ed25519' | 'rsa4096';

type CliOptions = {
  algo: Algorithm;
  email?: string;
  expire: string;
  help: boolean;
  json: boolean;
  name?: string;
  nonInteractive: boolean;
  outputDir?: string;
  passphraseBytes: number;
  publishTimeoutMs: number;
  skipPublish: boolean;
};

const TARGET_KEYS_OPENPGP = 'keys-openpgp';
const TARGET_PGP_MIT = 'pgp-mit';
const TARGET_KEYSERVER_UBUNTU = 'keyserver-ubuntu';

type PublicationTargetId = typeof TARGET_KEYS_OPENPGP | typeof TARGET_KEYSERVER_UBUNTU | typeof TARGET_PGP_MIT;

type PublicationTarget = {
  baseUrl: string;
  id: PublicationTargetId;
};

type PublicationResult = {
  details: string;
  endpoint: string;
  httpStatus?: number;
  requiresEmailVerification: boolean;
  success: boolean;
  target: PublicationTargetId;
  verificationRequested: boolean;
};

type SigningKeyMaterial = {
  createdAt: string;
  email: string;
  fingerprint: string;
  keyId: string;
  name: string;
  passphrase: string;
  privateKey: string;
  publicationResults: PublicationResult[];
  publicKey: string;
  revocationCertificate?: string;
  uid: string;
};

const DEFAULTS = {
  algo: 'rsa4096' as const,
  expire: '0',
  passphraseBytes: 256,
  publishTimeoutMs: 15_000,
};
const HKP_PUBLISH_MAX_ATTEMPTS = 3;
const HKP_RETRY_DELAY_MS = 750;

const SECTION_DIVIDER = '======================================================================';

const OPENPGP_MODULE = 'openpgp';
const URL_KEYS_OPENPGP = 'https://keys.openpgp.org';
const URL_PGP_MIT = 'https://pgp.mit.edu';
const URL_UBUNTU_KEYS = 'https://keyserver.ubuntu.com';

const COMMON_PUBLIC_KEYSERVERS: PublicationTarget[] = [
  { baseUrl: URL_KEYS_OPENPGP, id: TARGET_KEYS_OPENPGP },
  // Fails on local
  // { baseUrl: URL_PGP_MIT, id: TARGET_PGP_MIT },
  { baseUrl: URL_UBUNTU_KEYS, id: TARGET_KEYSERVER_UBUNTU },
];

const EXPIRY_SECONDS_PER_UNIT: Record<string, number> = {
  d: 24 * 60 * 60,
  h: 60 * 60,
  m: 60,
  s: 1,
  w: 7 * 24 * 60 * 60,
  y: 365 * 24 * 60 * 60,
};

type KeyIdHandle = {
  toHex: () => string;
};

type PrivateKeyHandle = {
  getFingerprint: () => string;
  getKeyID?: () => KeyIdHandle;
  getKeyIDs?: () => KeyIdHandle[];
};

type GeneratedOpenPgpKeys = {
  privateKey: string;
  publicKey: string;
  revocationCertificate?: string;
};

type OpenPgpModule = {
  generateKey: (options: Record<string, unknown>) => Promise<GeneratedOpenPgpKeys>;
  readPrivateKey: (options: { armoredKey: string }) => Promise<PrivateKeyHandle>;
};

function printHelp() {
  console.log(`Generate a hardened Maven Central OpenPGP signing key using pure TypeScript.

Usage:
  bun scripts/generate-maven-central-signing-key.ts [options]

Options:
  --name <value>              Signer name (default: Maven-Central-Signer-<timestamp>)
  --email <value>             Signer email (default: random users.noreply.local email)
  --algo <rsa4096|ed25519>    Key algorithm (default: rsa4096)
  --expire <value>            Key expiry as 0 or <number>[s|m|h|d|w|y] (default: 0)
  --publish-timeout-ms <n>    Upload timeout per keyserver request in ms (default: 15000)
  --skip-publish              Skip publishing to common public keyservers
                              (keys.openpgp.org, pgp.mit.edu, keyserver.ubuntu.com)
  --output-dir <path>         Write armored keys + metadata to secure files
  --passphrase-bytes <value>  Random bytes for passphrase entropy (default: 256)
  --json                      Output JSON instead of human-readable sections
  --non-interactive           Do not prompt for missing inputs
  -h, --help                  Show this help

Examples:
  bun scripts/generate-maven-central-signing-key.ts --name "My Project Signer" --non-interactive
  bun scripts/generate-maven-central-signing-key.ts --algo ed25519 --output-dir ./secure-signing-material
  bun scripts/generate-maven-central-signing-key.ts --skip-publish --non-interactive
`);
}

function parseAlgorithm(value: string): Algorithm {
  if (value === 'rsa4096' || value === 'ed25519') {
    return value;
  }
  throw new Error(`Unsupported algorithm: ${value}`);
}

function parsePassphraseBytes(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 16 || parsed > 1024) {
    throw new Error('--passphrase-bytes must be an integer between 16 and 1024');
  }
  return parsed;
}

function parsePublishTimeout(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 120_000) {
    throw new Error('--publish-timeout-ms must be an integer between 1000 and 120000');
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    algo: DEFAULTS.algo,
    expire: DEFAULTS.expire,
    help: false,
    json: false,
    nonInteractive: false,
    passphraseBytes: DEFAULTS.passphraseBytes,
    publishTimeoutMs: DEFAULTS.publishTimeoutMs,
    skipPublish: false,
  };

  const valueHandlers: Record<string, (value: string) => void> = {
    '--algo': (value: string) => {
      options.algo = parseAlgorithm(value);
    },
    '--email': (value: string) => {
      options.email = value;
    },
    '--expire': (value: string) => {
      options.expire = value;
    },
    '--name': (value: string) => {
      options.name = value;
    },
    '--output-dir': (value: string) => {
      options.outputDir = value;
    },
    '--passphrase-bytes': (value: string) => {
      options.passphraseBytes = parsePassphraseBytes(value);
    },
    '--publish-timeout-ms': (value: string) => {
      options.publishTimeoutMs = parsePublishTimeout(value);
    },
  };

  const flagHandlers: Record<string, () => void> = {
    '--help': () => {
      options.help = true;
    },
    '--json': () => {
      options.json = true;
    },
    '--non-interactive': () => {
      options.nonInteractive = true;
    },
    '--skip-publish': () => {
      options.skipPublish = true;
    },
    '-h': () => {
      options.help = true;
    },
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    const valueHandler = valueHandlers[arg];
    if (valueHandler) {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${arg}`);
      }
      valueHandler(value);
      index += 1;
      continue;
    }

    const flagHandler = flagHandlers[arg];
    if (flagHandler) {
      flagHandler();
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function loadOpenPgp(): Promise<OpenPgpModule> {
  try {
    const moduleImport: unknown = await import(OPENPGP_MODULE);
    return moduleImport as OpenPgpModule;
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing dependency "openpgp". Run "bun install" and retry.\nDetails: ${details}`, {
      cause: error,
    });
  }
}

function parseExpiryToSeconds(rawExpiry: string): number | undefined {
  const normalized = rawExpiry.trim().toLowerCase();
  if (normalized === '0' || normalized === 'none' || normalized === 'never') {
    return undefined;
  }

  const match = /^(\d+)([smhdwy]?)$/u.exec(normalized);
  if (!match) {
    throw new Error('Invalid --expire value. Use 0 or <number>[s|m|h|d|w|y], for example: 90d, 2y, 3600s.');
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2] || 's';
  const multiplier = EXPIRY_SECONDS_PER_UNIT[unit];
  if (!multiplier || amount <= 0) {
    throw new Error('Invalid --expire value. Duration must be greater than zero.');
  }

  return amount * multiplier;
}

function resolveKeyId(privateKey: PrivateKeyHandle, fingerprint: string): string {
  if (privateKey.getKeyID) {
    return privateKey.getKeyID().toHex().toUpperCase();
  }

  if (privateKey.getKeyIDs) {
    const [first] = privateKey.getKeyIDs();
    if (first) {
      return first.toHex().toUpperCase();
    }
  }

  return fingerprint.slice(-16).toUpperCase();
}

function buildDefaultName(now: Date): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const min = String(now.getUTCMinutes()).padStart(2, '0');
  const sec = String(now.getUTCSeconds()).padStart(2, '0');
  return `Maven-Central-Signer-${yyyy}${mm}${dd}-${hh}${min}${sec}`;
}

function buildDefaultEmail(now: Date): string {
  const nonce = randomBytes(4).toString('hex');
  return `maven-signer-${now.getTime()}-${nonce}@users.noreply.local`;
}

function generatePassphrase(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function validateEmail(email: string): void {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    throw new Error(`Invalid email address: ${email}`);
  }
}

async function makeSecureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { mode: 0o700, recursive: true });
  try {
    await fs.chmod(dirPath, 0o700);
  } catch {
    // chmod is best effort on Windows.
  }
}

async function writeSecureFile(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // chmod is best effort on Windows.
  }
}

async function resolveIdentity(options: CliOptions): Promise<{ email: string; hasCustomEmail: boolean; name: string }> {
  const now = new Date();
  const defaultName = buildDefaultName(now);
  const defaultEmail = buildDefaultEmail(now);

  let name = options.name?.trim();
  let email = options.email?.trim();
  let hasCustomEmail = Boolean(email);

  if (!options.nonInteractive && process.stdin.isTTY && process.stdout.isTTY) {
    name = await input({
      default: name || defaultName,
      message: 'Signer name:',
      validate: (value) => (value.trim().length > 0 ? true : 'Signer name cannot be empty.'),
    });

    const promptedEmail = await input({
      default: email || defaultEmail,
      message: 'Signer email:',
      validate: (value) => {
        const trimmed = value.trim();
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailPattern.test(trimmed) ? true : 'Enter a valid email address.';
      },
    });
    email = promptedEmail.trim();
    if (!hasCustomEmail && email !== defaultEmail) {
      hasCustomEmail = true;
    }
  }

  if (!name) {
    name = defaultName;
  }
  if (!email) {
    email = defaultEmail;
  }
  if (!hasCustomEmail && email !== defaultEmail) {
    hasCustomEmail = true;
  }

  validateEmail(email);

  return { email, hasCustomEmail, name };
}

async function resolveSigningOptions(options: CliOptions): Promise<CliOptions> {
  if (options.nonInteractive || !process.stdin.isTTY || !process.stdout.isTTY) {
    return options;
  }

  const selectedAlgo = await select<Algorithm>({
    choices: [
      { name: 'RSA 4096 (widely compatible)', value: 'rsa4096' },
      { name: 'Ed25519 (modern, compact)', value: 'ed25519' },
    ],
    default: options.algo,
    message: 'Key algorithm:',
  });

  const expiry = await input({
    default: options.expire,
    message: 'Key expiry (0 or <number>[s|m|h|d|w|y]):',
    validate: (value) => {
      try {
        parseExpiryToSeconds(value);
        return true;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  });

  const outputDir = await input({
    default: options.outputDir ?? '',
    message: 'Output directory for key files (optional):',
  });

  let skipPublish = options.skipPublish;
  if (!options.skipPublish) {
    const publishChoice = await select<boolean>({
      choices: [
        { name: 'Yes, publish to common public keyservers', value: true },
        { name: 'No, do not publish', value: false },
      ],
      default: true,
      message: 'Publish public key now?',
    });
    skipPublish = !publishChoice;
  }

  return {
    ...options,
    algo: selectedAlgo,
    expire: expiry.trim(),
    outputDir: outputDir.trim() || undefined,
    skipPublish,
  };
}

function formatResponseSnippet(content: string): string {
  const normalized = content.replaceAll(/\s+/g, ' ').trim();
  if (!normalized) {
    return '(empty response body)';
  }
  return normalized.slice(0, 240);
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof Error) {
    return error.message.toLowerCase().includes('aborted');
  }
  return false;
}

function normalizeNetworkError(error: unknown, timeoutMs: number): string {
  if (isAbortError(error)) {
    return `request timed out after ${timeoutMs}ms`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function publishViaHkpAdd(
  target: PublicationTarget,
  publicKey: string,
  timeoutMs: number,
): Promise<{ details: string; endpoint: string; httpStatus?: number; success: boolean }> {
  const endpoint = new URL('/pks/add', target.baseUrl).toString();
  const body = new URLSearchParams({ keytext: publicKey }).toString();

  for (let attempt = 1; attempt <= HKP_PUBLISH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        endpoint,
        {
          body,
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
          },
          method: 'POST',
        },
        timeoutMs,
      );
      const responseBody = await response.text();
      if (!response.ok) {
        const isRetryableStatus = response.status >= 500;
        if (isRetryableStatus && attempt < HKP_PUBLISH_MAX_ATTEMPTS) {
          await sleep(HKP_RETRY_DELAY_MS * attempt);
          continue;
        }

        return {
          details: `HKP upload rejected: ${formatResponseSnippet(responseBody)}`,
          endpoint,
          httpStatus: response.status,
          success: false,
        };
      }

      return {
        details: attempt > 1 ? `Uploaded via HKP /pks/add after ${attempt} attempts.` : 'Uploaded via HKP /pks/add.',
        endpoint,
        httpStatus: response.status,
        success: true,
      };
    } catch (error) {
      if (attempt < HKP_PUBLISH_MAX_ATTEMPTS) {
        await sleep(HKP_RETRY_DELAY_MS * attempt);
        continue;
      }

      return {
        details: `HKP upload error: ${normalizeNetworkError(error, timeoutMs)}`,
        endpoint,
        success: false,
      };
    }
  }

  return {
    details: 'HKP upload error: exhausted retry attempts.',
    endpoint,
    success: false,
  };
}

function parseOpenPgpUploadToken(responseBody: string): string | undefined {
  try {
    const parsed = JSON.parse(responseBody) as { token?: unknown };
    return typeof parsed.token === 'string' ? parsed.token : undefined;
  } catch {
    return undefined;
  }
}

async function publishToOpenPgpVks(
  publicKey: string,
  email: string,
  requestEmailVerification: boolean,
  timeoutMs: number,
): Promise<PublicationResult> {
  const uploadEndpoint = `${URL_KEYS_OPENPGP}/vks/v1/upload`;
  try {
    const uploadResponse = await fetchWithTimeout(
      uploadEndpoint,
      {
        body: JSON.stringify({ keytext: publicKey }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      },
      timeoutMs,
    );
    const uploadBody = await uploadResponse.text();
    if (!uploadResponse.ok) {
      return {
        details: `VKS upload rejected: ${formatResponseSnippet(uploadBody)}`,
        endpoint: uploadEndpoint,
        httpStatus: uploadResponse.status,
        requiresEmailVerification: true,
        success: false,
        target: TARGET_KEYS_OPENPGP,
        verificationRequested: false,
      };
    }

    const token = parseOpenPgpUploadToken(uploadBody);
    if (!requestEmailVerification) {
      return {
        details: 'Uploaded without email verification request (generated/default email).',
        endpoint: uploadEndpoint,
        httpStatus: uploadResponse.status,
        requiresEmailVerification: true,
        success: true,
        target: TARGET_KEYS_OPENPGP,
        verificationRequested: false,
      };
    }

    if (!token) {
      return {
        details: 'Uploaded to keys.openpgp.org (no verification token returned).',
        endpoint: uploadEndpoint,
        httpStatus: uploadResponse.status,
        requiresEmailVerification: true,
        success: true,
        target: TARGET_KEYS_OPENPGP,
        verificationRequested: false,
      };
    }

    const verifyEndpoint = `${URL_KEYS_OPENPGP}/vks/v1/request-verify`;
    const verifyResponse = await fetchWithTimeout(
      verifyEndpoint,
      {
        body: JSON.stringify({ addresses: [email], token }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      },
      timeoutMs,
    );
    const verifyBody = await verifyResponse.text();
    if (!verifyResponse.ok) {
      return {
        details: `Uploaded, but verification request failed: ${formatResponseSnippet(verifyBody)}`,
        endpoint: verifyEndpoint,
        httpStatus: verifyResponse.status,
        requiresEmailVerification: true,
        success: true,
        target: TARGET_KEYS_OPENPGP,
        verificationRequested: false,
      };
    }

    return {
      details: 'Uploaded and verification email requested.',
      endpoint: verifyEndpoint,
      httpStatus: verifyResponse.status,
      requiresEmailVerification: true,
      success: true,
      target: TARGET_KEYS_OPENPGP,
      verificationRequested: true,
    };
  } catch (error) {
    return {
      details: `VKS upload error: ${error instanceof Error ? error.message : String(error)}`,
      endpoint: uploadEndpoint,
      requiresEmailVerification: true,
      success: false,
      target: TARGET_KEYS_OPENPGP,
      verificationRequested: false,
    };
  }
}

async function publishToCommonKeyservers(
  publicKey: string,
  email: string,
  requestEmailVerification: boolean,
  timeoutMs: number,
): Promise<PublicationResult[]> {
  const publishOperations = COMMON_PUBLIC_KEYSERVERS.map(async (target) => {
    if (target.id === TARGET_KEYS_OPENPGP) {
      return await publishToOpenPgpVks(publicKey, email, requestEmailVerification, timeoutMs);
    }

    const hkpResult = await publishViaHkpAdd(target, publicKey, timeoutMs);
    return {
      details: hkpResult.details,
      endpoint: hkpResult.endpoint,
      httpStatus: hkpResult.httpStatus,
      requiresEmailVerification: false,
      success: hkpResult.success,
      target: target.id,
      verificationRequested: false,
    } satisfies PublicationResult;
  });

  return await Promise.all(publishOperations);
}

function renderHumanReadableResult(material: SigningKeyMaterial, outputDir?: string): void {
  const publicationSummary =
    material.publicationResults.length === 0
      ? ['PUBLICATION:  skipped']
      : [
          'PUBLICATION:',
          ...material.publicationResults.map((result) => {
            const status = result.success ? 'OK' : 'FAILED';
            const verification =
              result.requiresEmailVerification && result.verificationRequested
                ? ' (verification email requested)'
                : result.requiresEmailVerification
                  ? ' (manual email verification may be required)'
                  : '';
            return `  - ${result.target}: ${status}${verification} | ${result.details}`;
          }),
        ];

  const sections = [
    SECTION_DIVIDER,
    ' MAVEN CENTRAL OPENPGP SIGNING KEY GENERATED',
    SECTION_DIVIDER,
    `NAME:        ${material.name}`,
    `EMAIL:       ${material.email}`,
    `UID:         ${material.uid}`,
    `FINGERPRINT: ${material.fingerprint}`,
    `KEY ID:      ${material.keyId}`,
    `CREATED AT:  ${material.createdAt}`,
    outputDir ? `OUTPUT DIR:  ${outputDir}` : 'OUTPUT DIR:  (none)',
    ...publicationSummary,
    SECTION_DIVIDER,
    'PASSPHRASE:',
    material.passphrase,
    SECTION_DIVIDER,
    'PUBLIC KEY (ASCII-ARMORED):',
    material.publicKey.trimEnd(),
    SECTION_DIVIDER,
    'PRIVATE KEY (ASCII-ARMORED):',
    material.privateKey.trimEnd(),
    SECTION_DIVIDER,
    ...(material.revocationCertificate
      ? ['REVOCATION CERTIFICATE (ASCII-ARMORED):', material.revocationCertificate.trimEnd(), SECTION_DIVIDER]
      : []),
    'Store passphrase and private key in a secret manager immediately.',
    'Do not commit these values to source control or CI logs.',
    SECTION_DIVIDER,
  ];

  console.log(sections.join('\n'));
}

async function saveMaterialToDisk(outputDir: string, material: SigningKeyMaterial): Promise<void> {
  const resolvedOutputDir = path.resolve(outputDir);
  await makeSecureDir(resolvedOutputDir);

  const publicKeyPath = path.join(resolvedOutputDir, 'public.asc');
  const privateKeyPath = path.join(resolvedOutputDir, 'private.asc');
  const revocationPath = path.join(resolvedOutputDir, 'revocation.asc');
  const metadataPath = path.join(resolvedOutputDir, 'credentials.json');

  await writeSecureFile(publicKeyPath, material.publicKey);
  await writeSecureFile(privateKeyPath, material.privateKey);
  if (material.revocationCertificate) {
    await writeSecureFile(revocationPath, material.revocationCertificate);
  }
  await writeSecureFile(metadataPath, `${JSON.stringify(material, undefined, 2)}\n`);
}

function buildGenerateKeyOptions(
  options: CliOptions,
  name: string,
  email: string,
  passphrase: string,
): Record<string, unknown> {
  const expirationSeconds = parseExpiryToSeconds(options.expire);
  const algorithmOptions =
    options.algo === 'rsa4096' ? { rsaBits: 4096, type: 'rsa' } : { curve: 'ed25519', type: 'ecc' };

  return {
    ...algorithmOptions,
    ...(expirationSeconds === undefined ? {} : { keyExpirationTime: expirationSeconds }),
    format: 'armored',
    passphrase,
    userIDs: [{ email, name }],
  };
}

async function generateSigningMaterial(options: CliOptions): Promise<SigningKeyMaterial> {
  const openpgp = await loadOpenPgp();
  const identity = await resolveIdentity(options);
  const passphrase = generatePassphrase(options.passphraseBytes);
  const uid = `${identity.name} <${identity.email}>`;

  const generated = await openpgp.generateKey(
    buildGenerateKeyOptions(options, identity.name, identity.email, passphrase),
  );
  const parsedPrivateKey = await openpgp.readPrivateKey({ armoredKey: generated.privateKey });
  const fingerprint = parsedPrivateKey.getFingerprint().toUpperCase();
  const keyId = resolveKeyId(parsedPrivateKey, fingerprint);
  const publicationResults = options.skipPublish
    ? []
    : await publishToCommonKeyservers(
        generated.publicKey,
        identity.email,
        identity.hasCustomEmail,
        options.publishTimeoutMs,
      );

  if (!options.skipPublish && publicationResults.every((result) => !result.success)) {
    throw new Error(
      `Public key publication failed for all keyservers. Last errors: ${publicationResults
        .map((result) => `${result.target}: ${result.details}`)
        .join(' | ')}`,
    );
  }

  return {
    createdAt: new Date().toISOString(),
    email: identity.email,
    fingerprint,
    keyId,
    name: identity.name,
    passphrase,
    privateKey: generated.privateKey,
    publicationResults,
    publicKey: generated.publicKey,
    revocationCertificate: generated.revocationCertificate,
    uid,
  };
}

async function main() {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printHelp();
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    printHelp();
    return;
  }

  try {
    options = await resolveSigningOptions(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  try {
    const generated = await generateSigningMaterial(options);

    if (options.outputDir) {
      await saveMaterialToDisk(options.outputDir, generated);
    }

    if (options.json) {
      console.log(JSON.stringify(generated, undefined, 2));
      return;
    }

    renderHumanReadableResult(generated, options.outputDir);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
