import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, scryptSync } from 'node:crypto';

import { xsalsa20poly1305 } from '@noble/ciphers/salsa.js';

/**
 * Cosign's encrypted private key format, as written by `cosign generate-key-pair`.
 *
 * The PKCS#8 DER of an ECDSA P-256 key is sealed with NaCl secretbox (XSalsa20-Poly1305) under a
 * key derived by scrypt, serialised as the JSON envelope of go-securesystemslib's `encrypted`
 * package and wrapped in a PEM block. Keys are written with that package's standard scrypt
 * parameters, the ones `cosign generate-key-pair` uses.
 */
export const COSIGN_PRIVATE_KEY_PEM_TYPE = 'ENCRYPTED SIGSTORE PRIVATE KEY';

type ScryptParams = { N: number; p: number; r: number };

const KDF_NAME = 'scrypt';
const CIPHER_NAME = 'nacl/secretbox';
const SCRYPT_PARAMS: ScryptParams = { N: 65_536, p: 1, r: 8 };
// The cost settings go-securesystemslib accepts on import (legacy, standard, OWASP). Anything else
// is refused so a crafted file cannot choose its own cost.
const ACCEPTED_SCRYPT_N = new Set([32_768, 65_536, 131_072]);
const SALT_BYTES = 32;
const NONCE_BYTES = 24;
const BOX_KEY_BYTES = 32;
// Headroom over OpenSSL's scrypt memory check of 128 * r * (N + 2) + 128 * r * p bytes.
const SCRYPT_MEMORY_SLACK = 1024 * 1024;
const PEM_LINE_LENGTH = 64;

type EncryptedEnvelope = {
  cipher: { name: string; nonce: string };
  ciphertext: string;
  kdf: { name: string; params: ScryptParams; salt: string };
};

export type CosignKeyPair = {
  privateKey: string;
  publicKey: string;
};

function deriveBoxKey(password: string, salt: Uint8Array, params: ScryptParams): Uint8Array {
  return scryptSync(Buffer.from(password, 'utf8'), salt, BOX_KEY_BYTES, {
    maxmem: 128 * params.r * (params.N + 2) + 128 * params.r * params.p + SCRYPT_MEMORY_SLACK,
    N: params.N,
    p: params.p,
    r: params.r,
  });
}

function toPem(type: string, der: Uint8Array): string {
  const base64 = Buffer.from(der).toString('base64');
  const lines = base64.match(new RegExp(`.{1,${PEM_LINE_LENGTH}}`, 'gu')) ?? [];
  return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----\n`;
}

function fromPem(type: string, pem: string): Buffer {
  const begin = `-----BEGIN ${type}-----`;
  const end = `-----END ${type}-----`;
  const start = pem.indexOf(begin);
  const stop = pem.indexOf(end);
  if (start === -1 || stop === -1 || stop < start) {
    throw new Error(`Expected a PEM block of type "${type}".`);
  }
  return Buffer.from(pem.slice(start + begin.length, stop).replaceAll(/\s/gu, ''), 'base64');
}

/** Seals PKCS#8 DER bytes into a cosign-compatible encrypted private key PEM. */
export function encryptCosignPrivateKey(pkcs8Der: Uint8Array, password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const boxKey = deriveBoxKey(password, salt, SCRYPT_PARAMS);
  const ciphertext = xsalsa20poly1305(boxKey, nonce).encrypt(pkcs8Der);

  const envelope: EncryptedEnvelope = {
    cipher: { name: CIPHER_NAME, nonce: nonce.toString('base64') },
    ciphertext: Buffer.from(ciphertext).toString('base64'),
    kdf: { name: KDF_NAME, params: { ...SCRYPT_PARAMS }, salt: salt.toString('base64') },
  };

  return toPem(COSIGN_PRIVATE_KEY_PEM_TYPE, Buffer.from(JSON.stringify(envelope), 'utf8'));
}

type ParsedEnvelope = { ciphertext: Buffer; nonce: Buffer; params: ScryptParams; salt: Buffer };

function invalidEnvelope(reason: string, cause?: unknown): Error {
  return new Error(`Unsupported encrypted key envelope: ${reason}.`, { cause });
}

function decodeBase64Field(value: unknown, field: string): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidEnvelope(`missing ${field}`);
  }
  return Buffer.from(value, 'base64');
}

function parseEnvelope(json: string): ParsedEnvelope {
  let parsed: Partial<EncryptedEnvelope>;
  try {
    parsed = JSON.parse(json) as Partial<EncryptedEnvelope>;
  } catch (error) {
    throw invalidEnvelope('not JSON', error);
  }

  if (parsed.kdf?.name !== KDF_NAME || parsed.cipher?.name !== CIPHER_NAME) {
    throw invalidEnvelope(`expected ${KDF_NAME} + ${CIPHER_NAME}`);
  }
  const params = parsed.kdf.params;
  if (!params || !ACCEPTED_SCRYPT_N.has(params.N) || params.r !== 8 || params.p !== 1) {
    throw invalidEnvelope('scrypt parameters are not one of the accepted settings');
  }

  const salt = decodeBase64Field(parsed.kdf.salt, 'salt');
  const nonce = decodeBase64Field(parsed.cipher.nonce, 'nonce');
  if (salt.length !== SALT_BYTES || nonce.length !== NONCE_BYTES) {
    throw invalidEnvelope(`salt must be ${SALT_BYTES} bytes and nonce ${NONCE_BYTES} bytes`);
  }

  return { ciphertext: decodeBase64Field(parsed.ciphertext, 'ciphertext'), nonce, params, salt };
}

/** Opens a cosign encrypted private key PEM and returns the PKCS#8 DER bytes. */
export function decryptCosignPrivateKey(pem: string, password: string): Uint8Array {
  const envelope = parseEnvelope(fromPem(COSIGN_PRIVATE_KEY_PEM_TYPE, pem).toString('utf8'));
  const boxKey = deriveBoxKey(password, envelope.salt, envelope.params);

  try {
    return xsalsa20poly1305(boxKey, envelope.nonce).decrypt(envelope.ciphertext);
  } catch (error) {
    throw new Error('Decryption failed: wrong password or corrupted key.', { cause: error });
  }
}

/** Generates an ECDSA P-256 key pair in the formats `cosign generate-key-pair` writes. */
export function generateCosignKeyPair(password: string): CosignKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pkcs8Der = privateKey.export({ format: 'der', type: 'pkcs8' });

  return {
    privateKey: encryptCosignPrivateKey(pkcs8Der, password),
    publicKey: publicKey.export({ format: 'pem', type: 'spki' }),
  };
}

/** Confirms that `keyPair.privateKey` opens with `password` and belongs to `keyPair.publicKey`. */
export function verifyCosignKeyPair(keyPair: CosignKeyPair, password: string): void {
  const pkcs8Der = decryptCosignPrivateKey(keyPair.privateKey, password);
  const privateKey = createPrivateKey({ format: 'der', key: Buffer.from(pkcs8Der), type: 'pkcs8' });
  const derivedPublicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
  const expectedPublicKey = fromPem('PUBLIC KEY', keyPair.publicKey).toString('base64');

  if (derivedPublicKey !== expectedPublicKey) {
    throw new Error('Generated private key does not match the generated public key.');
  }
}
