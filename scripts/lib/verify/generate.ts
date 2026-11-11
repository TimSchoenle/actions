import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { workspacePackages } from 'action-graph';

import { IGNORED_FILES } from './affected.js';
import { workspaceMemberDirectories, workspaceModulePaths } from './jobs.js';
import { PLAN_FILE } from './plan-step.js';
import {
  assignShards,
  GENERATED_HEADER,
  renderShard,
  renderTarget,
  renderVerifyWorkflow,
  shardFile,
  shardSecrets,
  validateSources,
  VERIFY_WORKFLOW,
} from './render.js';
import { readSources } from './source.js';
import { deriveTargetInputs } from './target-inputs.js';

import type { PlanFile, PlannedTarget } from './affected.js';
import type { Shard } from './render.js';
import type { VerifySource } from './source.js';

/**
 * Everything `bun run generate-verify` writes, computed in memory so the write and the drift check
 * share one code path.
 *
 * @packageDocumentation
 */

/** Directory of the generated workflows, relative to the repository root. */
export const WORKFLOWS_DIR = '.github/workflows';

/** The generated files, by repository-relative path, in their final formatted form. */
export type GeneratedFiles = ReadonlyMap<string, string>;

/** Formats a generated file with the repository's formatter, so `format:check` agrees with it. */
function format(root: string, file: string, text: string): string {
  const binary = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'oxfmt.cmd' : 'oxfmt');
  const result = spawnSync(binary, [`--stdin-filepath=${file}`], { cwd: root, input: text, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`oxfmt could not format ${file}: ${result.stderr || result.error?.message || 'unknown error'}`);
  }

  return result.stdout;
}

/** The plan entry of one target. */
function plannedTarget(
  root: string,
  source: VerifySource,
  shard: Shard,
  packages: ReadonlyMap<string, string>,
): PlannedTarget {
  const derived = deriveTargetInputs(root, source, shardFile(shard.id), packages);

  return {
    id: source.target,
    shard: shard.id,
    inputs: derived.inputs,
    buildDirs: derived.buildDirs,
    pullRequestBranches: source.rules.pullRequestBranches ?? null,
    pushBranches: source.rules.pushBranches,
    schedule: source.rules.schedule,
  };
}

/** Computes every generated file from the sources and the dependency graph. */
export function generate(root: string): { files: GeneratedFiles; shards: readonly Shard[]; plan: PlanFile } {
  const sources = readSources(root);
  if (sources.length === 0) {
    throw new Error('No Verify sources found under .github/verify/.');
  }
  validateSources(root, sources);

  const packages = workspacePackages(root);
  const modulePaths = workspaceModulePaths(workspaceMemberDirectories(root));
  // Whether a target builds does not depend on its shard, so the shard file is a placeholder here.
  const rendered = sources.map((source) =>
    renderTarget(source, deriveTargetInputs(root, source, '', packages).buildDirs.length > 0, modulePaths),
  );
  const shards = assignShards(rendered);

  const files = new Map<string, string>();
  const secretsByShard = new Map<string, string[]>();
  for (const shard of shards) {
    const text = renderShard(shard);
    secretsByShard.set(shard.id, shardSecrets(text));
    files.set(shardFile(shard.id), format(root, shardFile(shard.id), text));
  }
  files.set(VERIFY_WORKFLOW, format(root, VERIFY_WORKFLOW, renderVerifyWorkflow(shards, modulePaths, secretsByShard)));

  const plan: PlanFile = {
    global: [VERIFY_WORKFLOW],
    ignore: IGNORED_FILES,
    targets: shards.flatMap((shard) =>
      shard.targets.map((target) => plannedTarget(root, target.source, shard, packages)),
    ),
  };
  const planText = JSON.stringify(
    { $comment: `${GENERATED_HEADER.slice(2)} Run 'bun run generate-verify' to rebuild it.`, ...plan },
    null,
    2,
  );
  files.set(PLAN_FILE, format(root, PLAN_FILE, `${planText}\n`));

  return { files, shards, plan };
}

/** Generated workflow files on disk that the generator no longer produces. */
function orphans(root: string, files: GeneratedFiles): string[] {
  const directory = path.join(root, WORKFLOWS_DIR);

  return fs
    .readdirSync(directory)
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => `${WORKFLOWS_DIR}/${file}`)
    .filter((file) => !files.has(file))
    .filter((file) => fs.readFileSync(path.join(root, file), 'utf8').startsWith(GENERATED_HEADER));
}

/** One generated file whose content on disk differs from what the generator produces. */
export interface Drift {
  readonly file: string;
  readonly reason: 'missing' | 'stale' | 'orphaned';
}

/** Compares the generated files against the disk, reporting every difference at once. */
export function findDrift(root: string): Drift[] {
  const { files } = generate(root);
  const drift: Drift[] = [];
  for (const [file, content] of files) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) {
      drift.push({ file, reason: 'missing' });
    } else if (fs.readFileSync(absolute, 'utf8') !== content) {
      drift.push({ file, reason: 'stale' });
    }
  }

  return [...drift, ...orphans(root, files).map((file) => ({ file, reason: 'orphaned' as const }))];
}

/** Writes every generated file and removes orphaned ones, returning the paths that changed. */
export function writeGenerated(root: string): string[] {
  const { files } = generate(root);
  const changed: string[] = [];
  for (const [file, content] of files) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || fs.readFileSync(absolute, 'utf8') !== content) {
      fs.writeFileSync(absolute, content);
      changed.push(file);
    }
  }
  for (const file of orphans(root, files)) {
    fs.rmSync(path.join(root, file));
    changed.push(file);
  }

  return changed;
}
