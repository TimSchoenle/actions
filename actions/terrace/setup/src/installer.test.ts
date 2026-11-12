import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ReleaseNotFoundError, VerificationError } from './errors.js';
import { GITHUB_OIDC_ISSUER, installCosign, installOras, installTerrace, TERRACE_SIGNER } from './installer.js';

import type { ReleaseAssetRef } from 'actions-util/release-download';

import type { InstallPorts, Runner } from './installer.js';

const LINUX: Runner = { platform: 'linux', arch: 'x64' };
const GOOD = 'a'.repeat(64);

/**
 * A fake network and tool cache. Each download is recorded as `<repository>@<tag>/<name>` and lands
 * at `/tmp/<name>`, and every downloaded file hashes to {@link GOOD} unless listed in `digests`.
 */
function fakePorts(
  options: { lists?: Record<string, string>; digests?: Record<string, string>; cached?: string } = {},
) {
  const downloaded: string[] = [];
  const ports: InstallPorts = {
    download: vi.fn((asset: ReleaseAssetRef) => {
      downloaded.push(`${asset.repository}@${asset.tag}/${asset.name}`);

      return Promise.resolve(`/tmp/${asset.name}`);
    }),
    extract: vi.fn(() => Promise.resolve('/tmp/unpacked')),
    cacheDirectory: vi.fn((_directory: string, tool: string, version: string) =>
      Promise.resolve(`/cache/${tool}/${version}`),
    ),
    cacheFile: vi.fn((_file: string, _name: string, tool: string, version: string) =>
      Promise.resolve(`/cache/${tool}/${version}`),
    ),
    find: vi.fn(() => options.cached ?? ''),
    readText: vi.fn((file: string) => Promise.resolve(options.lists?.[path.posix.basename(file)] ?? '')),
    sha256: vi.fn((file: string) => Promise.resolve(options.digests?.[path.posix.basename(file)] ?? GOOD)),
    makeExecutable: vi.fn(() => Promise.resolve()),
    run: vi.fn(() => Promise.resolve()),
    info: vi.fn(),
  };

  return { ports, downloaded };
}

describe('installTerrace', () => {
  const archive = 'terrace-contract-0.8.0-x86_64-unknown-linux-musl.tar.gz';
  const lists = { SHA256SUMS: `${GOOD}  ${archive}\n` };

  it('verifies the signature, then the checksum, then caches', async () => {
    const { ports, downloaded } = fakePorts({ lists });

    const installed = await installTerrace(ports, LINUX, '0.8.0', '/cache/cosign/3.1.3/cosign');

    const base = 'TimSchoenle/terrace-config@terrace-contract-v0.8.0';

    expect(downloaded).toEqual([`${base}/${archive}`, `${base}/SHA256SUMS`, `${base}/SHA256SUMS.sigstore.json`]);
    expect(ports.run).toHaveBeenCalledWith('/cache/cosign/3.1.3/cosign', [
      'verify-blob',
      '/tmp/SHA256SUMS',
      '--bundle',
      '/tmp/SHA256SUMS.sigstore.json',
      '--certificate-identity-regexp',
      TERRACE_SIGNER,
      '--certificate-github-workflow-repository',
      'TimSchoenle/terrace-config',
      '--certificate-oidc-issuer',
      GITHUB_OIDC_ISSUER,
    ]);
    expect(ports.extract).toHaveBeenCalledWith(`/tmp/${archive}`, 'tar.gz');
    expect(installed).toEqual({
      version: '0.8.0',
      path: path.join('/cache/terrace-contract/0.8.0', 'terrace-contract'),
    });
  });

  it('caches nothing when the signature does not verify', async () => {
    const { ports } = fakePorts({ lists });

    vi.mocked(ports.run).mockRejectedValue(new Error('none of the expected identities matched'));

    await expect(installTerrace(ports, LINUX, '0.8.0', 'cosign')).rejects.toThrow(VerificationError);
    expect(ports.cacheDirectory).not.toHaveBeenCalled();
  });

  it('caches nothing when the archive does not match its checksum', async () => {
    const { ports } = fakePorts({ lists, digests: { [archive]: 'b'.repeat(64) } });

    await expect(installTerrace(ports, LINUX, '0.8.0', 'cosign')).rejects.toThrow(VerificationError);
    expect(ports.cacheDirectory).not.toHaveBeenCalled();
  });

  it('explains a release that does not exist', async () => {
    const { ports } = fakePorts({ lists });

    vi.mocked(ports.download).mockRejectedValue(
      Object.assign(new Error('Unexpected HTTP response: 404'), { httpStatusCode: 404 }),
    );

    await expect(installTerrace(ports, LINUX, '9.9.9', 'cosign')).rejects.toThrow(ReleaseNotFoundError);
  });

  it('passes any other download failure through', async () => {
    const { ports } = fakePorts({ lists });

    vi.mocked(ports.download).mockRejectedValue(Object.assign(new Error('boom'), { httpStatusCode: 500 }));

    await expect(installTerrace(ports, LINUX, '0.8.0', 'cosign')).rejects.toThrow('boom');
  });

  it('reuses a verified copy from the tool cache without downloading', async () => {
    const { ports, downloaded } = fakePorts({ cached: '/cache/terrace-contract/0.8.0' });

    expect(await installTerrace(ports, LINUX, '0.8.0', 'cosign')).toEqual({
      version: '0.8.0',
      path: path.join('/cache/terrace-contract/0.8.0', 'terrace-contract'),
    });
    expect(downloaded).toEqual([]);
  });

  it('unpacks the zip on Windows', async () => {
    const zip = 'terrace-contract-0.8.0-x86_64-pc-windows-msvc.zip';
    const { ports } = fakePorts({ lists: { SHA256SUMS: `${GOOD}  ${zip}\n` } });

    const installed = await installTerrace(ports, { platform: 'win32', arch: 'x64' }, '0.8.0', 'cosign.exe');

    expect(ports.extract).toHaveBeenCalledWith(`/tmp/${zip}`, 'zip');
    expect(installed.path.endsWith('terrace-contract.exe')).toBe(true);
  });
});

describe('installCosign', () => {
  it('checks the binary against cosign_checksums.txt and caches it executable', async () => {
    const { ports, downloaded } = fakePorts({ lists: { 'cosign_checksums.txt': `${GOOD}  cosign-linux-amd64\n` } });

    const installed = await installCosign(ports, LINUX, 'v3.1.3', GOOD);

    expect(downloaded).toEqual([
      'sigstore/cosign@v3.1.3/cosign-linux-amd64',
      'sigstore/cosign@v3.1.3/cosign_checksums.txt',
    ]);
    expect(ports.cacheFile).toHaveBeenCalledWith('/tmp/cosign-linux-amd64', 'cosign', 'cosign', '3.1.3');
    expect(ports.makeExecutable).toHaveBeenCalledWith(installed.path);
    expect(installed).toEqual({ version: '3.1.3', path: path.join('/cache/cosign/3.1.3', 'cosign') });
  });

  it('refuses a binary the list does not record', async () => {
    const { ports } = fakePorts({ lists: { 'cosign_checksums.txt': `${GOOD}  cosign-darwin-arm64\n` } });

    await expect(installCosign(ports, LINUX, 'v3.1.3', GOOD)).rejects.toThrow(/does not list cosign-linux-amd64/);
    expect(ports.cacheFile).not.toHaveBeenCalled();
  });

  // The binary and the list come from the same release, so whoever can replace one can replace
  // both. The pinned digest of the list is what ties the install to the release the pin names.
  it('refuses a list that matches the binary but not the pin', async () => {
    const { ports } = fakePorts({
      lists: { 'cosign_checksums.txt': `${GOOD}  cosign-linux-amd64\n` },
      digests: { 'cosign_checksums.txt': 'b'.repeat(64) },
    });

    await expect(installCosign(ports, LINUX, 'v3.1.3', GOOD)).rejects.toThrow(VerificationError);
    await expect(installCosign(ports, LINUX, 'v3.1.3', GOOD)).rejects.toThrow(
      /cosign_checksums\.txt has SHA-256 b{64}, but cosign_checksums_sha256 pins a{64}/,
    );
    expect(ports.cacheFile).not.toHaveBeenCalled();
  });

  it('accepts the pin in upper case', async () => {
    const { ports } = fakePorts({ lists: { 'cosign_checksums.txt': `${GOOD}  cosign-linux-amd64\n` } });

    await expect(installCosign(ports, LINUX, 'v3.1.3', GOOD.toUpperCase())).resolves.toMatchObject({
      version: '3.1.3',
    });
  });
});

describe('installOras', () => {
  it('checks the archive against its checksum list and caches the unpacked directory', async () => {
    const name = 'oras_1.3.4_linux_amd64.tar.gz';
    const { ports, downloaded } = fakePorts({ lists: { 'oras_1.3.4_checksums.txt': `${GOOD}  ${name}\n` } });

    const installed = await installOras(ports, LINUX, '1.3.4', GOOD);

    expect(downloaded).toEqual([
      `oras-project/oras@v1.3.4/${name}`,
      'oras-project/oras@v1.3.4/oras_1.3.4_checksums.txt',
    ]);
    expect(installed).toEqual({ version: '1.3.4', path: path.join('/cache/oras/1.3.4', 'oras') });
  });

  it('refuses a list that matches the archive but not the pin', async () => {
    const name = 'oras_1.3.4_linux_amd64.tar.gz';
    const { ports } = fakePorts({
      lists: { 'oras_1.3.4_checksums.txt': `${GOOD}  ${name}\n` },
      digests: { 'oras_1.3.4_checksums.txt': 'b'.repeat(64) },
    });

    await expect(installOras(ports, LINUX, '1.3.4', GOOD)).rejects.toThrow(/oras_checksums_sha256 pins a{64}/);
    expect(ports.extract).not.toHaveBeenCalled();
    expect(ports.cacheDirectory).not.toHaveBeenCalled();
  });
});

describe('TERRACE_SIGNER', () => {
  const identity = (ref: string): string =>
    `https://github.com/TimSchoenle/terrace-config/.github/workflows/release-cli.yml@${ref}`;

  it('accepts only the release workflow on main', () => {
    const signer = new RegExp(TERRACE_SIGNER);

    expect(signer.test(identity('refs/heads/main'))).toBe(true);
    expect(signer.test(identity('refs/heads/main-backup'))).toBe(false);
    expect(signer.test(identity('refs/heads/feature'))).toBe(false);
    expect(signer.test(identity('refs/pull/1/merge'))).toBe(false);
  });
});
