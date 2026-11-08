import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
  sign,
  verify,
} from 'node:crypto';

import { xsalsa20poly1305 } from '@noble/ciphers/salsa.js';
import { describe, expect, it } from 'vitest';

import {
  COSIGN_PRIVATE_KEY_PEM_TYPE,
  decryptCosignPrivateKey,
  encryptCosignPrivateKey,
  generateCosignKeyPair,
  verifyCosignKeyPair,
} from '../cosign-key.js';

const PASSWORD = 'correct horse battery staple';

function envelopeOf(pem: string): Record<string, unknown> {
  const body = pem
    .replace(`-----BEGIN ${COSIGN_PRIVATE_KEY_PEM_TYPE}-----`, '')
    .replace(`-----END ${COSIGN_PRIVATE_KEY_PEM_TYPE}-----`, '')
    .replaceAll(/\s/gu, '');
  return JSON.parse(Buffer.from(body, 'base64').toString('utf8')) as Record<string, unknown>;
}

describe('cosign-key', () => {
  it('writes the envelope cosign reads: scrypt + nacl/secretbox in an ENCRYPTED SIGSTORE PRIVATE KEY block', () => {
    const { privateKey } = generateCosignKeyPair(PASSWORD);

    expect(privateKey.startsWith(`-----BEGIN ${COSIGN_PRIVATE_KEY_PEM_TYPE}-----\n`)).toBe(true);
    expect(privateKey.endsWith(`-----END ${COSIGN_PRIVATE_KEY_PEM_TYPE}-----\n`)).toBe(true);

    const envelope = envelopeOf(privateKey);
    expect(envelope).toMatchObject({
      cipher: { name: 'nacl/secretbox' },
      kdf: { name: 'scrypt', params: { N: 65_536, p: 1, r: 8 } },
    });
    const kdf = envelope.kdf as { salt: string };
    const cipher = envelope.cipher as { nonce: string };
    expect(Buffer.from(kdf.salt, 'base64')).toHaveLength(32);
    expect(Buffer.from(cipher.nonce, 'base64')).toHaveLength(24);
  });

  it('round-trips the PKCS#8 bytes through encryption', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const der = privateKey.export({ format: 'der', type: 'pkcs8' });

    const decrypted = decryptCosignPrivateKey(encryptCosignPrivateKey(der, PASSWORD), PASSWORD);

    expect(Buffer.from(decrypted).equals(der)).toBe(true);
  });

  it('uses a fresh salt and nonce for every encryption', () => {
    const der = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'der', type: 'pkcs8' });

    expect(encryptCosignPrivateKey(der, PASSWORD)).not.toBe(encryptCosignPrivateKey(der, PASSWORD));
  });

  it('rejects the wrong password', () => {
    const { privateKey } = generateCosignKeyPair(PASSWORD);

    expect(() => decryptCosignPrivateKey(privateKey, 'wrong')).toThrow(/wrong password/u);
  });

  describe('envelope validation', () => {
    const der = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'der', type: 'pkcs8' });
    const salt = randomBytes(32);
    const nonce = randomBytes(24);

    function sealWith(params: { N: number; p: number; r: number }): Record<string, unknown> {
      const key = scryptSync(PASSWORD, salt, 32, { maxmem: 256 * 1024 * 1024, ...params });
      return {
        cipher: { name: 'nacl/secretbox', nonce: nonce.toString('base64') },
        ciphertext: Buffer.from(xsalsa20poly1305(key, nonce).encrypt(der)).toString('base64'),
        kdf: { name: 'scrypt', params, salt: salt.toString('base64') },
      };
    }

    function pemOf(envelope: unknown): string {
      const body = Buffer.from(typeof envelope === 'string' ? envelope : JSON.stringify(envelope)).toString('base64');
      return `-----BEGIN ${COSIGN_PRIVATE_KEY_PEM_TYPE}-----\n${body}\n-----END ${COSIGN_PRIVATE_KEY_PEM_TYPE}-----\n`;
    }

    it.each([[32_768], [65_536], [131_072]])('opens keys sealed with the accepted cost N=%i', (N) => {
      const decrypted = decryptCosignPrivateKey(pemOf(sealWith({ N, p: 1, r: 8 })), PASSWORD);

      expect(Buffer.from(decrypted).equals(der)).toBe(true);
    });

    it('refuses scrypt parameters outside the accepted settings', () => {
      expect(() => decryptCosignPrivateKey(pemOf(sealWith({ N: 1024, p: 1, r: 8 })), PASSWORD)).toThrow(
        /scrypt parameters/u,
      );
    });

    it('refuses envelopes that are not JSON, have the wrong cipher or lack fields', () => {
      const valid = sealWith({ N: 32_768, p: 1, r: 8 });

      expect(() => decryptCosignPrivateKey(pemOf('not json'), PASSWORD)).toThrow(/not JSON/u);
      expect(() => decryptCosignPrivateKey(pemOf({ ...valid, cipher: { name: 'aes' } }), PASSWORD)).toThrow(
        /expected scrypt \+ nacl\/secretbox/u,
      );
      expect(() => decryptCosignPrivateKey(pemOf({ ...valid, cipher: { name: 'nacl/secretbox' } }), PASSWORD)).toThrow(
        /missing nonce/u,
      );
      expect(() =>
        decryptCosignPrivateKey(
          pemOf({ ...valid, cipher: { name: 'nacl/secretbox', nonce: randomBytes(12).toString('base64') } }),
          PASSWORD,
        ),
      ).toThrow(/nonce 24 bytes/u);
      expect(() => decryptCosignPrivateKey(pemOf({ ...valid, ciphertext: '' }), PASSWORD)).toThrow(
        /missing ciphertext/u,
      );
    });
  });

  it('rejects a PEM block of another type', () => {
    const { publicKey } = generateCosignKeyPair(PASSWORD);

    expect(() => decryptCosignPrivateKey(publicKey, PASSWORD)).toThrow(/ENCRYPTED SIGSTORE PRIVATE KEY/u);
  });

  it('produces a P-256 key pair whose private half signs what the public half verifies', () => {
    const keyPair = generateCosignKeyPair(PASSWORD);
    const der = Buffer.from(decryptCosignPrivateKey(keyPair.privateKey, PASSWORD));
    const privateKey = createPrivateKey({ format: 'der', key: der, type: 'pkcs8' });
    const publicKey = createPublicKey(keyPair.publicKey);
    const message = Buffer.from('payload');

    expect(publicKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
    expect(verify('sha256', message, publicKey, sign('sha256', message, privateKey))).toBe(true);
  });

  it('verifies a matching pair and rejects a mismatched one', () => {
    const first = generateCosignKeyPair(PASSWORD);
    const second = generateCosignKeyPair(PASSWORD);

    expect(() => verifyCosignKeyPair(first, PASSWORD)).not.toThrow();
    expect(() => verifyCosignKeyPair({ privateKey: first.privateKey, publicKey: second.publicKey }, PASSWORD)).toThrow(
      /does not match/u,
    );
  });
});
