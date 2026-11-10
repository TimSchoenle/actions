import { spawn } from 'node:child_process';
import fs from 'node:fs';

import { readActionManifest, sortedUnique, stageBundles, toAbsolute } from 'action-graph';

import type { StagedBundles } from 'action-graph';

/** Recorded in every manifest this action writes. */
export const GENERATED_BY = 'TimSchoenle/actions/actions/release/build-actions';

/** Runs one shell command and resolves with its exit code. Injected so tests need no real build. */
export type ShellRunner = (command: string, cwd: string, env: NodeJS.ProcessEnv) => Promise<number>;

/** One build request. Paths are relative to {@link BuildRequest.root}. */
export interface BuildRequest {
  /** Absolute path of the checkout root. */
  readonly root: string;
  readonly buildDirs: readonly string[];
  readonly command: string;
  readonly perDirectory: boolean;
  readonly sourceSha: string;
  readonly toolchain: string;
  /** Absolute path of an empty directory to stage into. */
  readonly stagingDirectory: string;
}

/**
 * The bundles the build directories must produce, read from their manifests before anything runs.
 *
 * Every directory must hold the manifest of a JavaScript action: a composite or Docker action has
 * nothing to build, and listing one is a mistake in the caller's list rather than a no-op.
 *
 * @throws an `Error` naming each directory that does not qualify
 */
export function expectedBundles(root: string, buildDirs: readonly string[]): string[] {
  const problems: string[] = [];
  const bundles: string[] = [];

  for (const directory of buildDirs) {
    const absolute = toAbsolute(root, directory);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
      problems.push(`${directory}: not a directory of the checkout.`);
      continue;
    }
    try {
      const manifest = readActionManifest(root, directory);
      if (manifest.bundles.length === 0) {
        problems.push(
          `${directory}: runs on '${manifest.using}', which ships no bundle. List the directories ` +
            'release/resolve-actions outputs as build-dirs.',
        );
      }
      bundles.push(...manifest.bundles);
    } catch (error) {
      problems.push((error as Error).message);
    }
  }

  if (problems.length > 0) {
    throw new Error(`build-dirs is invalid:\n  ${problems.join('\n  ')}`);
  }

  return sortedUnique(bundles);
}

/**
 * The environment a build command runs with: this process's, minus the `INPUT_*` variables the runner
 * set for this step, so the build sees the caller's job environment and not this action's inputs.
 */
export function buildEnvironment(extra: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('INPUT_')) {
      env[key] = value;
    }
  }

  return { ...env, ...extra };
}

/** Runs `command` with bash as the runner's default shell does: no profile, errexit and pipefail. */
export const runShell: ShellRunner = (command, cwd, env) =>
  new Promise((resolve, reject) => {
    const child = spawn('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', command], {
      cwd,
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve(code ?? (signal === null ? 1 : 128)));
  });

/**
 * Runs the build, then stages the bundles with their manifest.
 *
 * The expected bundles are read before the build runs, so a build that rewrites a manifest cannot
 * change what is checked afterwards.
 *
 * @throws an `Error` for an invalid build directory, a failing build command, or a bundle the build
 * did not produce
 */
export async function buildAndStage(request: BuildRequest, shell: ShellRunner = runShell): Promise<StagedBundles> {
  const bundles = expectedBundles(request.root, request.buildDirs);

  const runs = request.perDirectory
    ? request.buildDirs.map((directory) => ({
        cwd: toAbsolute(request.root, directory),
        label: directory,
        env: { BUILD_DIR: directory },
      }))
    : [{ cwd: request.root, label: '.', env: { BUILD_DIRS: request.buildDirs.join('\n') } }];

  for (const { cwd, label, env } of runs) {
    const exitCode = await shell(request.command, cwd, buildEnvironment(env));
    if (exitCode !== 0) {
      throw new Error(`The build command failed in ${label} with exit code ${exitCode}.`);
    }
  }

  return stageBundles(request.root, request.buildDirs, bundles, request.stagingDirectory, {
    sourceSha: request.sourceSha,
    toolchain: request.toolchain,
    generatedBy: GENERATED_BY,
  });
}
