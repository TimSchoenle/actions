import { chmod, readFile } from 'node:fs/promises';
import path from 'node:path';

import * as core from '@actions/core';
import { getExecOutput } from '@actions/exec';
import * as toolCache from '@actions/tool-cache';
import { resolveWithinWorkspace, runAction, workspaceRoot } from 'actions-util';

import { sha256File } from './checksums.js';
import { InvalidInputError, ReleaseNotFoundError } from './errors.js';
import { getInput, setOutput } from './generated/action-io.js';
import { installCosign, installOras, installTerrace } from './installer.js';
import { fetchJson, listReleases } from './releases.js';
import { readCliPin, REPO_CONFIG_FILE } from './repo-config.js';
import { formatVersion, isExact, parseVersionRequest, selectRelease } from './version.js';

import type { InstallPorts, Runner } from './installer.js';
import type { FetchJson } from './releases.js';
import type { VersionRequest } from './version.js';

/** The things this action cannot do for itself, injected so its wiring stays testable. */
export interface ActionDependencies {
  readonly ports: InstallPorts;
  readonly runner: Runner;
  readonly fetchJson: FetchJson;
  readonly readText: (file: string) => Promise<string>;
  readonly addPath: (directory: string) => void;
  readonly workspace: string;
}

/** The real ports, bound to the runner, its tool cache and the network. */
function defaultPorts(): InstallPorts {
  return {
    download: (url) => toolCache.downloadTool(url),
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

  const available = await listReleases(dependencies.fetchJson, token);
  const release = selectRelease(request, available);

  if (release === undefined) {
    throw new ReleaseNotFoundError(`No terrace-contract ${formatVersion(request)}.x release is published.`);
  }

  return formatVersion(release);
}

export async function run(dependencies: ActionDependencies = defaultDependencies()): Promise<void> {
  await runAction(async () => {
    const wantsOras = booleanInput('oras', getInput('oras'));
    const cosignVersion = toolVersionInput('cosign_version', getInput('cosign_version'), true);
    const orasVersion = wantsOras ? toolVersionInput('oras_version', getInput('oras_version'), false) : '';
    const { request, source } = await requestedVersion(
      dependencies,
      getInput('version'),
      getInput('working_directory'),
    );
    const version = await resolveRelease(dependencies, request, getInput('github_token'));

    core.info(`terrace-contract ${formatVersion(request)} from ${source} resolves to ${version}.`);

    const { ports, runner } = dependencies;
    const cosign = await installCosign(ports, runner, cosignVersion);
    const terrace = await installTerrace(ports, runner, version, cosign.path);

    dependencies.addPath(path.dirname(cosign.path));
    dependencies.addPath(path.dirname(terrace.path));
    setOutput('version', terrace.version);
    setOutput('path', terrace.path);
    setOutput('cosign_path', cosign.path);

    if (wantsOras) {
      const oras = await installOras(ports, runner, orasVersion);

      dependencies.addPath(path.dirname(oras.path));
      setOutput('oras_path', oras.path);
    } else {
      setOutput('oras_path', '');
    }
  });
}
