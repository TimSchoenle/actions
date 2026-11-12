/**
 * Downloading, verifying and caching each tool.
 *
 * Nothing reaches the tool cache, and so `PATH`, before it is verified: a cached directory is
 * trusted on a later run without being checked again, so caching is the last step of every install.
 *
 * - terrace-contract: cosign verifies the keyless signature over `SHA256SUMS` against the workflow
 *   identity that publishes it, then `SHA256SUMS` verifies the archive. What is pinned is the
 *   release workflow, not a key somebody holds.
 * - cosign and oras: the SHA-256 of each published checksum list is pinned next to the version, and
 *   the list then verifies the download. The binary and its list come from the same release, so
 *   whoever can replace one can replace both: the pin is what ties the install to the release that
 *   was pinned, not to whatever that tag holds today.
 */
import path from 'node:path';

import { errorMessage } from 'actions-util';
import { assertListed, parseChecksums } from 'actions-util/release-download';

import { ReleaseNotFoundError, VerificationError } from './errors.js';
import { COSIGN_CHECKSUMS, cosignAsset, orasAsset, orasChecksums, terraceAsset } from './platform.js';
import { RELEASE_REPOSITORY } from './releases.js';
import { RELEASE_TAG_PREFIX } from './version.js';

import type { Architecture, Asset, Packaging, Platform } from './platform.js';
import type { ReleaseAssetRef } from 'actions-util/release-download';

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
  /**
   * Downloads a release asset to a temporary file, through the REST API when the release download
   * fails. Rejects with `httpStatusCode` set on an HTTP failure.
   */
  download(asset: ReleaseAssetRef): Promise<string>;
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

/** A release: the repository as `owner/repo` and the tag. */
type Release = Omit<ReleaseAssetRef, 'name'>;

/** A checksum list and the pinned SHA-256 of the list itself, under the input that pins it. */
interface PinnedList {
  readonly name: string;
  readonly sha256: string;
  readonly input: 'cosign_checksums_sha256' | 'oras_checksums_sha256';
  readonly versionInput: 'cosign_version' | 'oras_version';
}

async function verifiedChecksums(
  ports: InstallPorts,
  file: string,
  asset: Asset,
  release: Release,
  pinned: PinnedList,
): Promise<void> {
  const listName = pinned.name;
  const list = await ports.download({ ...release, name: listName });
  const listDigest = (await ports.sha256(list)).toLowerCase();

  if (listDigest !== pinned.sha256.toLowerCase()) {
    throw new VerificationError(
      `${release.repository} ${release.tag}: ${listName} has SHA-256 ${listDigest}, but ${pinned.input} pins ` +
        `${pinned.sha256.toLowerCase()}, so nothing from the release is installed. A changed ${pinned.versionInput} ` +
        `needs ${pinned.input} set to the SHA-256 of that release's ${listName}.`,
    );
  }

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

/**
 * Installs cosign `version` (with its leading `v`), whose `cosign_checksums.txt` must hash to
 * `checksumsSha256`.
 */
export async function installCosign(
  ports: InstallPorts,
  runner: Runner,
  version: string,
  checksumsSha256: string,
): Promise<Installed> {
  const plain = version.replace(/^v/, '');
  const asset = cosignAsset(runner.platform, runner.arch);
  const hit = fromCache(ports, 'cosign', plain, asset.binary);

  if (hit !== undefined) {
    return { version: plain, path: hit };
  }

  const release: Release = { repository: 'sigstore/cosign', tag: version };

  ports.info(`Downloading cosign ${version} (${asset.name}).`);
  const file = await ports.download({ ...release, name: asset.name });

  await verifiedChecksums(ports, file, asset, release, {
    name: COSIGN_CHECKSUMS,
    sha256: checksumsSha256,
    input: 'cosign_checksums_sha256',
    versionInput: 'cosign_version',
  });

  return { version: plain, path: await cached(ports, file, asset, 'cosign', plain) };
}

/** Installs oras `version` (without a leading `v`), whose checksum list must hash to `checksumsSha256`. */
export async function installOras(
  ports: InstallPorts,
  runner: Runner,
  version: string,
  checksumsSha256: string,
): Promise<Installed> {
  const asset = orasAsset(version, runner.platform, runner.arch);
  const hit = fromCache(ports, 'oras', version, asset.binary);

  if (hit !== undefined) {
    return { version, path: hit };
  }

  const release: Release = { repository: 'oras-project/oras', tag: `v${version}` };

  ports.info(`Downloading oras ${version} (${asset.name}).`);
  const file = await ports.download({ ...release, name: asset.name });

  await verifiedChecksums(ports, file, asset, release, {
    name: orasChecksums(version),
    sha256: checksumsSha256,
    input: 'oras_checksums_sha256',
    versionInput: 'oras_version',
  });

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

  const release: Release = { repository: RELEASE_REPOSITORY, tag: `${RELEASE_TAG_PREFIX}${version}` };
  const fetchFile = async (name: string): Promise<string> => {
    try {
      return await ports.download({ ...release, name });
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
