import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  formatHumanReadableResult,
  formatJsonResult,
  generateCosignMaterial,
  parseArgs,
  saveMaterialToDisk,
  shouldPrintSecrets,
} from '../generate-cosign-key.js';
import { decryptCosignPrivateKey } from '../lib/cosign-key.js';

describe('generate-cosign-key', () => {
  describe('parseArgs', () => {
    it('applies defaults', () => {
      expect(parseArgs([])).toEqual({
        help: false,
        json: false,
        nonInteractive: false,
        passwordBytes: 64,
        printSecrets: false,
      });
    });

    it('reads every option', () => {
      expect(
        parseArgs([
          '--output-dir',
          'out',
          '--password-bytes',
          '32',
          '--json',
          '--non-interactive',
          '--print-secrets',
          '-h',
        ]),
      ).toEqual({
        help: true,
        json: true,
        nonInteractive: true,
        outputDir: 'out',
        passwordBytes: 32,
        printSecrets: true,
      });
    });

    it.each([['15'], ['1025'], ['64abc']])('rejects --password-bytes %s', (value) => {
      expect(() => parseArgs(['--password-bytes', value])).toThrow(/between 16 and 1024/u);
    });

    it('rejects a missing value and an unknown argument', () => {
      expect(() => parseArgs(['--output-dir'])).toThrow('Missing value for --output-dir');
      expect(() => parseArgs(['--output-dir', '--json'])).toThrow('Missing value for --output-dir');
      expect(() => parseArgs(['--nope'])).toThrow('Unknown argument: --nope');
    });
  });

  it('generates a password of the requested entropy that opens the private key', () => {
    const material = generateCosignMaterial(32);

    expect(Buffer.from(material.password, 'base64url')).toHaveLength(32);
    expect(() => decryptCosignPrivateKey(material.privateKey, material.password)).not.toThrow();
  });

  // S16h: the key and password were printed even when they had just been written to owner-only
  // files, leaving a copy in the terminal scrollback or a CI log.
  describe('printing the secrets', () => {
    const material = generateCosignMaterial(16);

    it('prints them only without an output directory, unless asked to', () => {
      expect(shouldPrintSecrets({ outputDir: undefined, printSecrets: false })).toBe(true);
      expect(shouldPrintSecrets({ outputDir: 'out', printSecrets: false })).toBe(false);
      expect(shouldPrintSecrets({ outputDir: 'out', printSecrets: true })).toBe(true);
    });

    it('leaves the password and private key out of both reports when they are on disk', () => {
      for (const report of [
        formatHumanReadableResult(material, 'out', false),
        formatJsonResult(material, 'out', false),
      ]) {
        expect(report).not.toContain(material.password);
        expect(report).not.toContain(material.privateKey.trim());
        expect(report).toContain(material.publicKey.trim().split('\n')[1]);
        expect(report).toContain(path.resolve('out'));
      }
    });

    it('includes them when printing is on', () => {
      expect(formatHumanReadableResult(material, undefined, true)).toContain(material.password);
      expect(JSON.parse(formatJsonResult(material, undefined, true))).toEqual(material);
    });
  });

  describe('saveMaterialToDisk', () => {
    let directory: string | undefined;

    afterEach(async () => {
      if (directory) {
        await rm(directory, { force: true, recursive: true });
      }
    });

    it('writes cosign.key, cosign.pub and credentials.json', async () => {
      directory = await mkdtemp(path.join(os.tmpdir(), 'cosign-key-'));
      const outputDir = path.join(directory, 'nested');
      const material = generateCosignMaterial(16);

      await saveMaterialToDisk(outputDir, material);

      expect(await readFile(path.join(outputDir, 'cosign.key'), 'utf8')).toBe(material.privateKey);
      expect(await readFile(path.join(outputDir, 'cosign.pub'), 'utf8')).toBe(material.publicKey);
      expect(JSON.parse(await readFile(path.join(outputDir, 'credentials.json'), 'utf8'))).toEqual(material);
    });

    it('refuses to overwrite an existing key set and writes nothing', async () => {
      directory = await mkdtemp(path.join(os.tmpdir(), 'cosign-key-'));
      await writeFile(path.join(directory, 'cosign.pub'), 'existing');

      await expect(saveMaterialToDisk(directory, generateCosignMaterial(16))).rejects.toThrow(
        /Refusing to overwrite existing file/u,
      );
      expect(await readFile(path.join(directory, 'cosign.pub'), 'utf8')).toBe('existing');
      expect(await readdir(directory)).toEqual(['cosign.pub']);
    });
  });
});
