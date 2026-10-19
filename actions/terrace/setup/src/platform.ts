/**
 * Which published file to download for the runner, for each of the three tools.
 *
 * Measured against the published releases rather than assumed. terrace-contract builds four targets:
 * both Linux architectures as static musl binaries, `aarch64-apple-darwin` and
 * `x86_64-pc-windows-msvc`. There is no Intel macOS build, so that combination is refused rather
 * than served the nearest match.
 */
import { UnsupportedPlatformError } from './errors.js';

/** A runner's operating system, as `process.platform` names it. */
export type Platform = NodeJS.Platform;

/** A runner's architecture, as `process.arch` names it. */
export type Architecture = NodeJS.Architecture;

/** How a downloaded file holds its binary. */
export type Packaging = 'binary' | 'tar.gz' | 'zip';

/** One file to download, and the executable it yields. */
export interface Asset {
  /** The file name in the release. */
  readonly name: string;
  readonly packaging: Packaging;
  /** The executable's file name, inside the archive or as the downloaded file is renamed to. */
  readonly binary: string;
}

const TERRACE_TARGETS: Readonly<Partial<Record<Platform, Partial<Record<Architecture, string>>>>> = {
  linux: { x64: 'x86_64-unknown-linux-musl', arm64: 'aarch64-unknown-linux-musl' },
  darwin: { arm64: 'aarch64-apple-darwin' },
  win32: { x64: 'x86_64-pc-windows-msvc' },
};

/** Go's names, which both cosign and oras publish under. */
const GO_OS: Readonly<Partial<Record<Platform, string>>> = { linux: 'linux', darwin: 'darwin', win32: 'windows' };
const GO_ARCH: Readonly<Partial<Record<Architecture, string>>> = { x64: 'amd64', arm64: 'arm64' };

function executable(name: string, platform: Platform): string {
  return platform === 'win32' ? `${name}.exe` : name;
}

/** The terrace-contract archive for `version` on this runner. */
export function terraceAsset(version: string, platform: Platform, arch: Architecture): Asset {
  const target = TERRACE_TARGETS[platform]?.[arch];

  if (target === undefined) {
    throw new UnsupportedPlatformError('terrace-contract', platform, arch);
  }

  const packaging = platform === 'win32' ? 'zip' : 'tar.gz';

  return {
    name: `terrace-contract-${version}-${target}.${packaging}`,
    packaging,
    binary: executable('terrace-contract', platform),
  };
}

function goTarget(tool: string, platform: Platform, arch: Architecture): { os: string; arch: string } {
  const os = GO_OS[platform];
  const goArch = GO_ARCH[arch];

  // cosign and oras both skip Windows on ARM.
  if (os === undefined || goArch === undefined || (os === 'windows' && goArch !== 'amd64')) {
    throw new UnsupportedPlatformError(tool, platform, arch);
  }

  return { os, arch: goArch };
}

/** The cosign binary on this runner. cosign publishes bare executables, not archives. */
export function cosignAsset(platform: Platform, arch: Architecture): Asset {
  const target = goTarget('cosign', platform, arch);

  return {
    name: executable(`cosign-${target.os}-${target.arch}`, platform),
    packaging: 'binary',
    binary: executable('cosign', platform),
  };
}

/** The checksum list each cosign release publishes beside its binaries. */
export const COSIGN_CHECKSUMS = 'cosign_checksums.txt';

/** The oras archive for `version` (without its leading `v`) on this runner. */
export function orasAsset(version: string, platform: Platform, arch: Architecture): Asset {
  const target = goTarget('oras', platform, arch);
  const packaging = platform === 'win32' ? 'zip' : 'tar.gz';

  return {
    name: `oras_${version}_${target.os}_${target.arch}.${packaging}`,
    packaging,
    binary: executable('oras', platform),
  };
}

/** The checksum list each oras release publishes beside its archives. */
export function orasChecksums(version: string): string {
  return `oras_${version}_checksums.txt`;
}
