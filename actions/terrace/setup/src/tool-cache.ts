/**
 * The runner's tool cache, as `@actions/tool-cache` lays it out: `$RUNNER_TOOL_CACHE/<tool>/<version>/<arch>`,
 * complete once a sibling `<arch>.complete` marker exists. A later job — or another action using the
 * toolkit — finds what this one cached, and the other way round.
 *
 * Only the five calls this action makes, ported from `@actions/tool-cache` 4.0.0. The toolkit package
 * depends on `@actions/core` and `@actions/http-client`, which put undici — over 400 KB — into this
 * bundle for downloads it never makes: release assets come through `actions-util/release-download`.
 *
 * One deliberate narrowing: the toolkit's `find` also accepts a semver range and picks the highest
 * cached match. Every version this action caches or looks up is an exact `MAJOR.MINOR.PATCH`, so
 * only exact lookups are supported, and the `semver` package stays out of the bundle with them.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { exec } from '@actions/exec';
import { which } from '@actions/io';
import * as core from 'actions-util/core';

/** The environment this module reads, injectable for tests. */
type Environment = Readonly<Record<string, string | undefined>>;

const IS_WINDOWS = process.platform === 'win32';

/** An exact version as the toolkit's `semver.clean` leaves it: digits, a dot, digits, a dot, digits. */
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

function requireEnv(env: Environment, name: 'RUNNER_TEMP' | 'RUNNER_TOOL_CACHE'): string {
  const value = env[name] || '';

  if (value === '') {
    throw new Error(`Expected ${name} to be defined`);
  }

  return value;
}

function isDebug(env: Environment): boolean {
  return env.RUNNER_DEBUG === '1';
}

function assertExact(version: string): void {
  if (!EXACT_VERSION.test(version)) {
    throw new Error(`The tool cache only takes an exact MAJOR.MINOR.PATCH version, got ${JSON.stringify(version)}.`);
  }
}

/** The cache directory of `tool` at `version` for `arch`. */
function toolPath(env: Environment, tool: string, version: string, arch: string): string {
  return path.join(requireEnv(env, 'RUNNER_TOOL_CACHE'), tool, version, arch);
}

/** Empties (or creates) the cache directory of a tool and drops its completion marker. */
async function createToolPath(env: Environment, tool: string, version: string, arch: string): Promise<string> {
  const folder = toolPath(env, tool, version, arch);
  core.debug(`destination ${folder}`);

  await rm(folder, { recursive: true, force: true });
  await rm(`${folder}.complete`, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });

  return folder;
}

/** Marks a tool's cache directory complete, which is what {@link find} looks for. */
async function completeToolPath(env: Environment, tool: string, version: string, arch: string): Promise<void> {
  await writeFile(`${toolPath(env, tool, version, arch)}.complete`, '');
  core.debug('finished caching tool');
}

/** A new, empty directory under `RUNNER_TEMP` to extract into. */
async function createExtractFolder(env: Environment): Promise<string> {
  const destination = path.join(requireEnv(env, 'RUNNER_TEMP'), randomUUID());
  await mkdir(destination, { recursive: true });

  return destination;
}

/**
 * Extracts a gzipped tarball into a new directory and returns it, with the flags the toolkit passes
 * (`--overwrite` and `--warning=no-unknown-keyword` for GNU tar, which also needs `--force-local` on
 * Windows so a `C:` path is not read as a remote host).
 */
export async function extractTar(file: string, env: Environment = process.env): Promise<string> {
  const destination = await createExtractFolder(env);

  let versionOutput = '';
  await exec('tar --version', [], {
    ignoreReturnCode: true,
    silent: true,
    listeners: {
      stdout: (data) => (versionOutput += data.toString()),
      stderr: (data) => (versionOutput += data.toString()),
    },
  });
  core.debug(versionOutput.trim());

  const isGnuTar = versionOutput.toUpperCase().includes('GNU TAR');
  const args = ['xz'];
  let destinationArg = destination;
  let fileArg = file;

  if (isDebug(env)) {
    args.push('-v');
  }

  if (IS_WINDOWS && isGnuTar) {
    args.push('--force-local');
    destinationArg = destination.replaceAll('\\', '/');
    fileArg = file.replaceAll('\\', '/');
  }

  if (isGnuTar) {
    args.push('--warning=no-unknown-keyword', '--overwrite');
  }

  args.push('-C', destinationArg, '-f', fileArg);
  await exec('tar', args);

  return destination;
}

/** Quotes a path for a single-quoted PowerShell string, dropping what could end the command. */
function powershellLiteral(value: string): string {
  return value.replaceAll("'", "''").replaceAll(/["\n\r]/g, '');
}

async function extractZipWindows(file: string, destination: string): Promise<void> {
  const escapedFile = powershellLiteral(file);
  const escapedDestination = powershellLiteral(destination);
  const pwsh = await which('pwsh', false);

  if (pwsh) {
    const command = [
      `$ErrorActionPreference = 'Stop' ;`,
      `try { Add-Type -AssemblyName System.IO.Compression.ZipFile } catch { } ;`,
      `try { [System.IO.Compression.ZipFile]::ExtractToDirectory('${escapedFile}', '${escapedDestination}', $true) }`,
      `catch { if (($_.Exception.GetType().FullName -eq 'System.Management.Automation.MethodException') -or ($_.Exception.GetType().FullName -eq 'System.Management.Automation.RuntimeException') ){ Expand-Archive -LiteralPath '${escapedFile}' -DestinationPath '${escapedDestination}' -Force } else { throw $_ } } ;`,
    ].join(' ');

    core.debug(`Using pwsh at path: ${pwsh}`);
    await exec(`"${pwsh}"`, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Unrestricted',
      '-Command',
      command,
    ]);

    return;
  }

  const command = [
    `$ErrorActionPreference = 'Stop' ;`,
    `try { Add-Type -AssemblyName System.IO.Compression.FileSystem } catch { } ;`,
    `if ((Get-Command -Name Expand-Archive -Module Microsoft.PowerShell.Archive -ErrorAction Ignore)) { Expand-Archive -LiteralPath '${escapedFile}' -DestinationPath '${escapedDestination}' -Force }`,
    `else {[System.IO.Compression.ZipFile]::ExtractToDirectory('${escapedFile}', '${escapedDestination}', $true) }`,
  ].join(' ');
  const powershell = await which('powershell', true);

  core.debug(`Using powershell at path: ${powershell}`);
  await exec(`"${powershell}"`, [
    '-NoLogo',
    '-Sta',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Unrestricted',
    '-Command',
    command,
  ]);
}

async function extractZipUnix(file: string, destination: string, env: Environment): Promise<void> {
  const unzip = await which('unzip', true);
  // -o overwrites without the prompt that would otherwise hang the step.
  const args = isDebug(env) ? ['-o', file] : ['-o', '-q', file];

  await exec(`"${unzip}"`, args, { cwd: destination });
}

/** Extracts a zip archive into a new directory and returns it: PowerShell on Windows, `unzip` elsewhere. */
export async function extractZip(file: string, env: Environment = process.env): Promise<string> {
  const destination = await createExtractFolder(env);

  await (IS_WINDOWS ? extractZipWindows(file, destination) : extractZipUnix(file, destination, env));

  return destination;
}

/** Copies the contents of `sourceDir` into the cache as `tool` at `version`, and returns the cached directory. */
export async function cacheDir(
  sourceDir: string,
  tool: string,
  version: string,
  env: Environment = process.env,
): Promise<string> {
  assertExact(version);
  const arch = os.arch();
  core.debug(`Caching tool ${tool} ${version} ${arch}`);

  if (!statSync(sourceDir).isDirectory()) {
    throw new Error('sourceDir is not a directory');
  }

  const destination = await createToolPath(env, tool, version, arch);
  for (const item of await readdir(sourceDir)) {
    await cp(path.join(sourceDir, item), path.join(destination, item), {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    });
  }

  await completeToolPath(env, tool, version, arch);

  return destination;
}

/** Copies `sourceFile` into the cache as `targetFile` of `tool` at `version`, and returns the cached directory. */
export async function cacheFile(
  sourceFile: string,
  targetFile: string,
  tool: string,
  version: string,
  env: Environment = process.env,
): Promise<string> {
  assertExact(version);
  const arch = os.arch();
  core.debug(`Caching tool ${tool} ${version} ${arch}`);

  if (!statSync(sourceFile).isFile()) {
    throw new Error('sourceFile is not a file');
  }

  const destination = await createToolPath(env, tool, version, arch);
  await cp(sourceFile, path.join(destination, targetFile), { force: true });
  await completeToolPath(env, tool, version, arch);

  return destination;
}

/** The cached directory of `tool` at exactly `version`, or `''` when it is not (completely) cached. */
export function find(tool: string, version: string, env: Environment = process.env): string {
  if (!tool) {
    throw new Error('toolName parameter is required');
  }

  assertExact(version);
  const cachePath = toolPath(env, tool, version, os.arch());
  core.debug(`checking cache: ${cachePath}`);

  return existsSync(cachePath) && existsSync(`${cachePath}.complete`) ? cachePath : '';
}
