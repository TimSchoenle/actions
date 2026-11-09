import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

import * as core from '@actions/core';
import { errorMessage, quoteForLog, runAction } from 'actions-util';
import {
  assertReleaseAssetRef,
  checksumFiles,
  createReleaseDownloadPorts,
  InvalidReleaseAssetError,
  isSha256,
  ReleaseDownloader,
  verifySha256,
  verifyWithChecksums,
} from 'actions-util/release-download';

import { ActionInput, getInput, setOutput } from './generated/action-io.js';

import type { ChecksumFiles, ReleaseAssetRef, ReleaseDownloadOptions } from 'actions-util/release-download';

/** An input, alone or with the others, is not a value this action can use. */
export class InvalidInputError extends Error {
  constructor(
    readonly input: string,
    reason: string,
  ) {
    super(`${input}: ${reason}`);
    this.name = 'InvalidInputError';
  }
}

/** How the asset is verified: against its own pinned digest, or through a pinned checksums file. */
export type Verification =
  | { readonly kind: 'sha256'; readonly sha256: string }
  | { readonly kind: 'checksums'; readonly name: string; readonly sha256: string };

/** The things this action cannot do for itself, injected so it can be tested offline. */
export interface ActionDependencies {
  /** Downloads a release asset to a file, with the given credentials. */
  readonly download: (options: ReleaseDownloadOptions, asset: ReleaseAssetRef, destination: string) => Promise<void>;
  readonly files: ChecksumFiles;
  /** A new empty directory for this run's downloads. */
  readonly makeDirectory: () => Promise<string>;
  readonly removeDirectory: (directory: string) => Promise<void>;
  /** `GITHUB_SERVER_URL` of the job. */
  readonly serverUrl: string;
}

function defaultDependencies(): ActionDependencies {
  let downloader: ReleaseDownloader | undefined;

  return {
    download: (options, asset, destination) => {
      downloader ??= new ReleaseDownloader(createReleaseDownloadPorts('download-release-asset'), options);

      return downloader.download(asset, destination);
    },
    files: checksumFiles,
    makeDirectory: () => {
      const temp = process.env.RUNNER_TEMP;

      if (temp === undefined || temp === '') {
        throw new Error('RUNNER_TEMP is not set, so there is nowhere to download to.');
      }

      return mkdtemp(path.join(temp, 'download-release-asset-'));
    },
    removeDirectory: (directory) => rm(directory, { recursive: true, force: true }),
    serverUrl: process.env.GITHUB_SERVER_URL ?? '',
  };
}

const SHA256 = ActionInput.sha256;
const CHECKSUMS_ASSET = ActionInput['checksums-asset'];
const CHECKSUMS_SHA256 = ActionInput['checksums-sha256'];
const CHECKSUMS_PAIR = `${CHECKSUMS_ASSET} with ${CHECKSUMS_SHA256}`;

/** The verification the inputs ask for. Exactly one of the two ways must be fully set. */
export function verificationFrom(sha256: string, checksumsAsset: string, checksumsSha256: string): Verification {
  const viaChecksums = checksumsAsset !== '' || checksumsSha256 !== '';

  if (sha256 !== '' && viaChecksums) {
    throw new InvalidInputError(SHA256, `set either ${SHA256}, or ${CHECKSUMS_PAIR}, not both.`);
  }

  if (sha256 !== '') {
    return { kind: 'sha256', sha256: pin(SHA256, sha256) };
  }

  if (!viaChecksums) {
    throw new InvalidInputError(SHA256, `set ${SHA256}, or ${CHECKSUMS_PAIR}, so the download can be verified.`);
  }

  if (checksumsAsset === '' || checksumsSha256 === '') {
    throw new InvalidInputError(
      checksumsAsset === '' ? CHECKSUMS_ASSET : CHECKSUMS_SHA256,
      `${CHECKSUMS_ASSET} and ${CHECKSUMS_SHA256} must be set together.`,
    );
  }

  return { kind: 'checksums', name: checksumsAsset, sha256: pin(CHECKSUMS_SHA256, checksumsSha256) };
}

/** `value` when it is a SHA-256, so a mistyped pin fails before anything is downloaded. */
function pin(input: typeof SHA256 | typeof CHECKSUMS_SHA256, value: string): string {
  if (!isSha256(value)) {
    throw new InvalidInputError(input, `must be a SHA-256 of 64 hex digits, got ${JSON.stringify(value)}.`);
  }

  return value;
}

/** Throws unless `asset` can be requested, naming the input that cannot. */
function assertRequestable(asset: ReleaseAssetRef, nameInput: typeof ActionInput.asset | typeof CHECKSUMS_ASSET): void {
  try {
    assertReleaseAssetRef(asset);
  } catch (error) {
    if (error instanceof InvalidReleaseAssetError) {
      throw new InvalidInputError(error.field === 'name' ? nameInput : error.field, error.reason);
    }

    throw error;
  }
}

/** Downloads and verifies the asset into `directory`, returning its path. */
async function downloadVerified(
  dependencies: ActionDependencies,
  options: ReleaseDownloadOptions,
  asset: ReleaseAssetRef,
  verification: Verification,
  directory: string,
): Promise<string> {
  const file = path.join(directory, asset.name);

  if (verification.kind === 'sha256') {
    await dependencies.download(options, asset, file);
    await verifySha256(dependencies.files, file, asset.name, verification.sha256);

    return file;
  }

  // The list gets a directory of its own, removed afterwards, so the output directory holds the
  // asset alone and two names differing only in case cannot overwrite each other.
  const listDirectory = await dependencies.makeDirectory();
  const checksums = { file: path.join(listDirectory, verification.name), name: verification.name };

  try {
    // The list is checked before the asset is downloaded, so a wrong pin fails without the large download.
    await dependencies.download(options, { ...asset, name: checksums.name }, checksums.file);
    await verifySha256(dependencies.files, checksums.file, checksums.name, verification.sha256);
    await dependencies.download(options, asset, file);
    await verifyWithChecksums(dependencies.files, checksums, verification.sha256, { file, name: asset.name });
  } finally {
    await removeQuietly(dependencies, listDirectory);
  }

  return file;
}

/**
 * Removes `directory`, logging rather than throwing when that fails: the removal runs on the way out
 * of a failure or after a success, and must not replace what is being reported.
 */
async function removeQuietly(dependencies: ActionDependencies, directory: string): Promise<void> {
  try {
    await dependencies.removeDirectory(directory);
  } catch (error) {
    core.warning(`Could not remove ${directory}: ${errorMessage(error)}`);
  }
}

export async function run(dependencies: ActionDependencies = defaultDependencies()): Promise<void> {
  await runAction(async () => {
    const asset: ReleaseAssetRef = {
      repository: getInput('repository'),
      tag: getInput('tag'),
      name: getInput('asset'),
    };
    const verification = verificationFrom(getInput('sha256'), getInput(CHECKSUMS_ASSET), getInput(CHECKSUMS_SHA256));

    assertRequestable(asset, 'asset');

    if (verification.kind === 'checksums') {
      assertRequestable({ ...asset, name: verification.name }, CHECKSUMS_ASSET);

      if (verification.name.toLowerCase() === asset.name.toLowerCase()) {
        throw new InvalidInputError(CHECKSUMS_ASSET, 'must name a different file than asset.');
      }
    }

    const options: ReleaseDownloadOptions = { token: getInput('token'), serverUrl: dependencies.serverUrl };
    const directory = await dependencies.makeDirectory();
    let file: string;

    try {
      file = await downloadVerified(dependencies, options, asset, verification, directory);
    } catch (error) {
      // Nothing unverified is left behind for a later step to pick up.
      await removeQuietly(dependencies, directory);
      throw error;
    }

    core.info(`Verified ${quoteForLog(asset.name)} from ${asset.repository} ${quoteForLog(asset.tag)}: ${file}`);
    setOutput('path', file);
  });
}
