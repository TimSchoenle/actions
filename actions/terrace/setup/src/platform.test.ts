import { describe, expect, it } from 'vitest';

import { UnsupportedPlatformError } from './errors.js';
import { cosignAsset, orasAsset, orasChecksums, terraceAsset } from './platform.js';

describe('terraceAsset', () => {
  it.each([
    ['linux', 'x64', 'terrace-contract-0.8.0-x86_64-unknown-linux-musl.tar.gz', 'terrace-contract'],
    ['linux', 'arm64', 'terrace-contract-0.8.0-aarch64-unknown-linux-musl.tar.gz', 'terrace-contract'],
    ['darwin', 'arm64', 'terrace-contract-0.8.0-aarch64-apple-darwin.tar.gz', 'terrace-contract'],
    ['win32', 'x64', 'terrace-contract-0.8.0-x86_64-pc-windows-msvc.zip', 'terrace-contract.exe'],
  ] as const)('names the %s/%s archive', (platform, arch, name, binary) => {
    expect(terraceAsset('0.8.0', platform, arch)).toMatchObject({ name, binary });
  });

  it.each([
    ['darwin', 'x64'],
    ['win32', 'arm64'],
    ['freebsd', 'x64'],
  ] as const)('refuses %s/%s, which no release targets', (platform, arch) => {
    expect(() => terraceAsset('0.8.0', platform, arch)).toThrow(UnsupportedPlatformError);
  });
});

describe('cosignAsset', () => {
  it('names the bare executable, with .exe on Windows', () => {
    expect(cosignAsset('linux', 'arm64')).toEqual({
      name: 'cosign-linux-arm64',
      packaging: 'binary',
      binary: 'cosign',
    });
    expect(cosignAsset('win32', 'x64')).toEqual({
      name: 'cosign-windows-amd64.exe',
      packaging: 'binary',
      binary: 'cosign.exe',
    });
  });

  it('refuses Windows on ARM', () => {
    expect(() => cosignAsset('win32', 'arm64')).toThrow(UnsupportedPlatformError);
  });
});

describe('orasAsset', () => {
  it('names the archive and the checksum list', () => {
    expect(orasAsset('1.3.4', 'darwin', 'x64')).toEqual({
      name: 'oras_1.3.4_darwin_amd64.tar.gz',
      packaging: 'tar.gz',
      binary: 'oras',
    });
    expect(orasAsset('1.3.4', 'win32', 'x64').name).toBe('oras_1.3.4_windows_amd64.zip');
    expect(orasChecksums('1.3.4')).toBe('oras_1.3.4_checksums.txt');
  });
});
