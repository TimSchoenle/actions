import { chmod, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';

import { getExecOutput } from '@actions/exec';
import { resolveWithinWorkspace, runAction, workspaceRoot } from 'actions-util';
import * as core from 'actions-util/core';
import { createReleaseDownloadPorts, ReleaseDownloader, sha256File } from 'actions-util/release-download';

import { InvalidInputError, ReleaseNotFoundError } from './errors.js';
import { getInput, setOutput } from './generated/action-io.js';
import { installCosign, installOras, installTerrace } from './installer.js';
import { fetchJson, latestRelease } from './releases.js';
import { readCliPin, REPO_CONFIG_FILE } from './repo-config.js';
import * as toolCache from './tool-cache.js';
import { formatVersion, isExact, parseVersionRequest } from './version.js';

import type { InstallPorts, Runner } from './installer.js';
import type { FetchJson } from './releases.js';
import type { VersionRequest } from './version.js';
import type { ReleaseDownloadOptions } from 'actions-util/release-download';

/** The things this action cannot do for itself, injected so its wiring stays testable. */
export interface ActionDependencies {
  readonly ports: InstallPorts;
  readonly runner: Runner;
  readonly fetchJson: FetchJson;
  readonly readText: (file: string) => Promise<string>;
  readonly addPath: (directory: string) => void;
  readonly workspace: string;
}

/** Creates the downloader for the given credentials. */
export type CreateDownloader = (options: ReleaseDownloadOptions) => Pick<ReleaseDownloader, 'download'>;

/**
 * The download port: each asset into a new directory under `RUNNER_TEMP`, which the runner empties
 * after the job.
 *
 * The downloader is created on the first download, once the inputs are readable: the REST API
 * fallback authenticates with github_token, and only when the job runs on github.com.
 */
export function releaseDownloadPort(
  env: Readonly<Record<string, string | undefined>>,
  readToken: () => string,
  createDownloader: CreateDownloader,
): InstallPorts['download'] {
  let downloader: Pick<ReleaseDownloader, 'download'> | undefined;

  return async (asset) => {
    const temp = env.RUNNER_TEMP;

    if (temp === undefined || temp === '') {
      throw new Error('RUNNER_TEMP is not set, so there is nowhere to download to.');
    }

    downloader ??= createDownloader({ token: readToken(), serverUrl: env.GITHUB_SERVER_URL ?? '' });

    const file = path.join(await mkdtemp(path.join(temp, 'terrace-setup-')), asset.name);

    await downloader.download(asset, file);

    return file;
  };
}

/** The real ports, bound to the runner, its tool cache and the network. */
function defaultPorts(): InstallPorts {
  return {
    download: releaseDownloadPort(
      process.env,
      () => getInput('github_token'),
      (options) => new ReleaseDownloader(createReleaseDownloadPorts('terrace-setup'), options),
    ),
    extract: (archive, packaging) =>
      packaging === 'zip' ? toolCache.extractZip(archive) : toolCache.extractTar(archive),
    cacheDirectory: (directory, tool, version) => toolCache.cacheDir(directory, tool, version),
    cacheFile: (file, name, tool, version) => toolCache.cacheFile(file, name, tool, version),
    find: (tool, version) => toolCache.find(tool, version),
    readText: (file) => readFile(file, 'utf8'),
    sha256: sha256File,
    makeExecutable: async (file) => {
      if (process.platform !== 'win32') {
        await chmod(file, 0o755);
      }
    },
    run: async (command, args) => {
      const result = await getExecOutput(command, [...args], { ignoreReturnCode: true, silent: true });

      if (result.exitCode !== 0) {
        throw new Error(
          `${path.basename(command)} exited ${result.exitCode}: ${(result.stderr || result.stdout).trim()}`,
        );
      }
    },
    info: (message) => core.info(message),
  };
}

function defaultDependencies(): ActionDependencies {
  return {
    ports: defaultPorts(),
    runner: { platform: process.platform, arch: process.arch },
    fetchJson,
    readText: (file) => readFile(file, 'utf8'),
    addPath: (directory) => core.addPath(directory),
    workspace: workspaceRoot(),
  };
}

/** Parses a boolean input strictly, so a typo fails the step rather than reading as `false`. */
function booleanInput(name: 'oras', value: string): boolean {
  switch (value.trim().toLowerCase()) {
    case 'true':
      return true;
    case 'false':
    case '':
      return false;
    default:
      throw new InvalidInputError(name, `must be true or false, got ${JSON.stringify(value)}.`);
  }
}

/**
 * An exact tool release from an input, with its leading `v` when `prefixed`. Checked because it is
 * spliced into a download URL: anything but a version would request some other path on GitHub.
 */
function toolVersionInput(name: 'cosign_version' | 'oras_version', value: string, prefixed: boolean): string {
  const trimmed = value.trim();
  const bare = prefixed && trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
  const request = prefixed && bare === trimmed ? undefined : parseVersionRequest(bare);

  if (request === undefined || !isExact(request)) {
    const shape = prefixed ? 'vMAJOR.MINOR.PATCH' : 'MAJOR.MINOR.PATCH';

    throw new InvalidInputError(name, `must be ${shape}, got ${JSON.stringify(value)}.`);
  }

  return trimmed;
}

const SHA256_PATTERN = /^[\dA-Fa-f]{64}$/;

/** A pinned SHA-256 from an input, required: an empty pin would verify nothing. */
function sha256Input(name: 'cosign_checksums_sha256' | 'oras_checksums_sha256', value: string): string {
  const trimmed = value.trim();

  if (!SHA256_PATTERN.test(trimmed)) {
    throw new InvalidInputError(name, `must be a SHA-256 of 64 hex digits, got ${JSON.stringify(value)}.`);
  }

  return trimmed.toLowerCase();
}

/** The version the caller asked for: the input when set, otherwise the `cli` pin in `terrace.yaml`. */
async function requestedVersion(
  dependencies: ActionDependencies,
  version: string,
  workingDirectory: string,
): Promise<{ request: VersionRequest; source: string }> {
  if (version.trim() !== '') {
    const request = parseVersionRequest(version);

    if (request === undefined) {
      throw new InvalidInputError(
        'version',
        `must be MAJOR.MINOR or MAJOR.MINOR.PATCH, got ${JSON.stringify(version)}.`,
      );
    }

    return { request, source: 'the version input' };
  }

  const directory = resolveWithinWorkspace(workingDirectory, dependencies.workspace, 'working_directory');
  const file = path.join(directory, REPO_CONFIG_FILE);
  let text: string;

  try {
    text = await dependencies.readText(file);
  } catch {
    throw new InvalidInputError(
      'version',
      `is empty and ${file} cannot be read, so there is no terrace-contract version to install. Set the ` +
        'version input, or point working_directory at the directory holding terrace.yaml.',
    );
  }

  return { request: readCliPin(text, file), source: file };
}

/** The exact release a request resolves to, listing the published releases only when it must. */
async function resolveRelease(
  dependencies: ActionDependencies,
  request: VersionRequest,
  token: string,
): Promise<string> {
  if (isExact(request)) {
    return formatVersion(request);
  }

  const release = await latestRelease(dependencies.fetchJson, token, request.major, request.minor);

  if (release === undefined) {
    throw new ReleaseNotFoundError(`No terrace-contract ${formatVersion(request)}.x release is published.`);
  }

  return formatVersion(release);
}

export async function run(dependencies: ActionDependencies = defaultDependencies()): Promise<void> {
  await runAction(async () => {
    const wantsOras = booleanInput('oras', getInput('oras'));
    const cosignVersion = toolVersionInput('cosign_version', getInput('cosign_version'), true);
    const cosignChecksums = sha256Input('cosign_checksums_sha256', getInput('cosign_checksums_sha256'));
    const orasVersion = wantsOras ? toolVersionInput('oras_version', getInput('oras_version'), false) : '';
    const orasChecksums = wantsOras ? sha256Input('oras_checksums_sha256', getInput('oras_checksums_sha256')) : '';
    const { request, source } = await requestedVersion(
      dependencies,
      getInput('version'),
      getInput('working_directory'),
    );
    const version = await resolveRelease(dependencies, request, getInput('github_token'));

    core.info(`terrace-contract ${formatVersion(request)} from ${source} resolves to ${version}.`);

    const { ports, runner } = dependencies;
    const cosign = await installCosign(ports, runner, cosignVersion, cosignChecksums);
    const terrace = await installTerrace(ports, runner, version, cosign.path);
    // Every requested tool is installed before anything is published, so a failed step leaves
    // nothing on PATH and no outputs for a later step to mistake for a working install.
    const oras = wantsOras ? await installOras(ports, runner, orasVersion, orasChecksums) : undefined;

    dependencies.addPath(path.dirname(cosign.path));
    dependencies.addPath(path.dirname(terrace.path));
    setOutput('version', terrace.version);
    setOutput('path', terrace.path);
    setOutput('cosign_path', cosign.path);

    if (oras !== undefined) {
      dependencies.addPath(path.dirname(oras.path));
      setOutput('oras_path', oras.path);
    } else {
      setOutput('oras_path', '');
    }
  });
}
