/**
 * Downloading, verifying and caching each tool.
 *
 * Nothing reaches the tool cache, and so `PATH`, before it is verified: a cached directory is
 * trusted on a later run without being checked again, so caching is the last step of every install.
 *
 * - terrace-contract: cosign verifies the keyless signature over `SHA256SUMS` against the workflow
 *   identity that publishes it, then `SHA256SUMS` verifies the archive. What is pinned is the
 *   release workflow, not a key somebody holds.
 * - cosign and oras: their published checksum lists verify the download. That proves integrity, not
 *   authorship; the TLS connection to GitHub is the trust anchor for these two, as it is for every
 *   pinned tool a workflow downloads.
 */
import path from 'node:path';

import { errorMessage } from 'actions-util';

import { assertListed, parseChecksums } from './checksums.js';
import { ReleaseNotFoundError, VerificationError } from './errors.js';
import { COSIGN_CHECKSUMS, cosignAsset, orasAsset, orasChecksums, terraceAsset } from './platform.js';
import { RELEASE_REPOSITORY } from './releases.js';
import { RELEASE_TAG_PREFIX } from './version.js';

import type { Architecture, Asset, Packaging, Platform } from './platform.js';

/**
 * The certificate identity every terrace-contract `SHA256SUMS` signature must carry: the release
 * workflow as release-please calls it from `main`. Any other ref, a branch or a pull request
 * included, can run the same workflow file and must not be able to sign a release.
 */
export const TERRACE_SIGNER = String.raw`^https://github\.com/TimSchoenle/terrace-config/\.github/workflows/release-cli\.yml@refs/heads/main$`;

/** The OIDC issuer GitHub Actions signs under. */
export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';

/** What an install needs from the outside world, injected so each install can be tested offline. */
export interface InstallPorts {
  /** Downloads a URL to a temporary file. Rejects with `httpStatusCode` set on an HTTP failure. */
  download(url: string): Promise<string>;
  /** Unpacks an archive into a new temporary directory. */
  extract(archive: string, packaging: Exclude<Packaging, 'binary'>): Promise<string>;
  /** Copies a directory into the tool cache, returning the cached directory. */
  cacheDirectory(directory: string, tool: string, version: string): Promise<string>;
  /** Copies one file into the tool cache under `name`, returning the cached directory. */
  cacheFile(file: string, name: string, tool: string, version: string): Promise<string>;
  /** The cached directory for a tool and version, or `''` when it is not cached. */
  find(tool: string, version: string): string;
  readText(file: string): Promise<string>;
  sha256(file: string): Promise<string>;
  /** Marks a file executable. A no-op on Windows. */
  makeExecutable(file: string): Promise<void>;
  /** Runs a command, rejecting with its output when it exits non-zero. */
  run(command: string, args: readonly string[]): Promise<void>;
  info(message: string): void;
}

/** The runner an install targets. */
export interface Runner {
  readonly platform: Platform;
  readonly arch: Architecture;
}

/** An installed tool: its version and the absolute path of its executable. */
export interface Installed {
  readonly version: string;
  readonly path: string;
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'httpStatusCode' in error) {
    const status = (error as { httpStatusCode?: unknown }).httpStatusCode;

    return typeof status === 'number' ? status : undefined;
  }

  return undefined;
}

async function verifiedChecksums(
  ports: InstallPorts,
  file: string,
  asset: Asset,
  listUrl: string,
  listName: string,
): Promise<void> {
  const list = await ports.download(listUrl);
  const digests = parseChecksums(await ports.readText(list), listName);

  assertListed(digests, listName, asset.name, await ports.sha256(file));
}

/** The directory holding a tool's executable after unpacking, or the downloaded file itself. */
async function cached(ports: InstallPorts, file: string, asset: Asset, tool: string, version: string): Promise<string> {
  if (asset.packaging === 'binary') {
    const directory = await ports.cacheFile(file, asset.binary, tool, version);
    const executable = path.join(directory, asset.binary);

    await ports.makeExecutable(executable);

    return executable;
  }

  const unpacked = await ports.extract(file, asset.packaging);
  const directory = await ports.cacheDirectory(unpacked, tool, version);

  return path.join(directory, asset.binary);
}

/** The cached executable, when a previous run on this runner already verified and cached it. */
function fromCache(ports: InstallPorts, tool: string, version: string, binary: string): string | undefined {
  const directory = ports.find(tool, version);

  if (directory === '') {
    return undefined;
  }

  ports.info(`${tool} ${version} is already cached at ${directory}.`);

  return path.join(directory, binary);
}

/** Installs cosign `version` (with its leading `v`). */
export async function installCosign(ports: InstallPorts, runner: Runner, version: string): Promise<Installed> {
  const plain = version.replace(/^v/, '');
  const asset = cosignAsset(runner.platform, runner.arch);
  const hit = fromCache(ports, 'cosign', plain, asset.binary);

  if (hit !== undefined) {
    return { version: plain, path: hit };
  }

  const base = `https://github.com/sigstore/cosign/releases/download/${version}`;

  ports.info(`Downloading cosign ${version} (${asset.name}).`);
  const file = await ports.download(`${base}/${asset.name}`);

  await verifiedChecksums(ports, file, asset, `${base}/${COSIGN_CHECKSUMS}`, COSIGN_CHECKSUMS);

  return { version: plain, path: await cached(ports, file, asset, 'cosign', plain) };
}

/** Installs oras `version` (without a leading `v`). */
export async function installOras(ports: InstallPorts, runner: Runner, version: string): Promise<Installed> {
  const asset = orasAsset(version, runner.platform, runner.arch);
  const hit = fromCache(ports, 'oras', version, asset.binary);

  if (hit !== undefined) {
    return { version, path: hit };
  }

  const base = `https://github.com/oras-project/oras/releases/download/v${version}`;

  ports.info(`Downloading oras ${version} (${asset.name}).`);
  const file = await ports.download(`${base}/${asset.name}`);
  const list = orasChecksums(version);

  await verifiedChecksums(ports, file, asset, `${base}/${list}`, list);

  return { version, path: await cached(ports, file, asset, 'oras', version) };
}

/** Installs terrace-contract `version`, verifying it with the cosign at `cosign`. */
export async function installTerrace(
  ports: InstallPorts,
  runner: Runner,
  version: string,
  cosign: string,
): Promise<Installed> {
  const asset = terraceAsset(version, runner.platform, runner.arch);
  const hit = fromCache(ports, 'terrace-contract', version, asset.binary);

  if (hit !== undefined) {
    return { version, path: hit };
  }

  const base = `https://github.com/${RELEASE_REPOSITORY}/releases/download/${RELEASE_TAG_PREFIX}${version}`;
  const fetchFile = async (name: string): Promise<string> => {
    try {
      return await ports.download(`${base}/${name}`);
    } catch (error) {
      if (httpStatus(error) === 404) {
        throw new ReleaseNotFoundError(
          `terrace-contract ${version} publishes no ${name}. If that version was just pinned, its release ` +
            'has not been published yet.',
          error,
        );
      }

      throw error;
    }
  };

  ports.info(`Downloading terrace-contract ${version} (${asset.name}).`);
  const archive = await fetchFile(asset.name);
  const sums = await fetchFile('SHA256SUMS');
  const bundle = await fetchFile('SHA256SUMS.sigstore.json');

  // The signature over the checksum list first, then the checksum over the archive: a list nobody
  // signed proves nothing about the archive it names.
  try {
    await ports.run(cosign, [
      'verify-blob',
      sums,
      '--bundle',
      bundle,
      '--certificate-identity-regexp',
      TERRACE_SIGNER,
      '--certificate-github-workflow-repository',
      RELEASE_REPOSITORY,
      '--certificate-oidc-issuer',
      GITHUB_OIDC_ISSUER,
    ]);
  } catch (error) {
    throw new VerificationError(
      `terrace-contract ${version}: cosign could not verify SHA256SUMS as signed by ${TERRACE_SIGNER}, so nothing ` +
        `from the release is installed. ${errorMessage(error)}`,
      error,
    );
  }
  assertListed(
    parseChecksums(await ports.readText(sums), 'SHA256SUMS'),
    'SHA256SUMS',
    asset.name,
    await ports.sha256(archive),
  );

  return { version, path: await cached(ports, archive, asset, 'terrace-contract', version) };
}
