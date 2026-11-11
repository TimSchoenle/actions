import fs from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'yaml';

import { getTagCommitSha } from '../readme/utils.js';
import { consumerTag } from '../release-tags.js';
import { ROOT_DIR, scanSorted } from '../utils.js';
import { GENERATED_HEADER } from '../verify/render.js';
import { sourceFileName, SOURCES_DIR } from '../verify/source.js';
import { DOCS_FILE_NAME, validateDocsFile } from './docs-file.js';
import { parseActionManifest } from './manifest.js';
import { findRegions, MarkerError, newReadme, spliceRegions } from './markers.js';
import { renderRegions, usesReference } from './render.js';
import { pinUses, referencedActions } from './uses.js';

import type { ActionDocs, DocsValidation } from './docs-file.js';
import type { ActionManifest } from './manifest.js';
import type { LoadedExample, ReadmeModel, Release } from './render.js';

/** Disk and git access, injected so the generator can run against an in-memory repository in tests. */
export interface DocsIo {
  /** Repository-relative paths matching a shallow glob (`*` within one segment), sorted. */
  list(pattern: string): Promise<string[]>;
  /** File content, or `undefined` when the file does not exist. */
  read(file: string): Promise<string | undefined>;
  write(file: string, content: string): Promise<void>;
  /** The commit a tag points at, or `undefined` when it does not resolve. */
  tagSha(tag: string): Promise<string | undefined>;
}

export interface GenerationReport {
  /** READMEs and example files whose content changed. */
  written: string[];
  /** Problems that make a README wrong or impossible to generate. The run fails on any. */
  errors: string[];
  /** Gaps that are allowed for now: a README without `docs:generated` regions. */
  warnings: string[];
}

const MANIFEST_FILE = '.release-please-manifest.json';
const RELEASE_CONFIG_FILE = 'release-please-config.json';

/** Action manifests, one level below a category. A helper one level deeper is not published. */
const ACTION_PATTERNS = ['actions/*/*/action.yaml', 'actions/*/*/action.yml'];

/** Files that can call an action: workflows, published actions and their helpers. */
const CALLER_PATTERNS = [
  '.github/workflows/*.yaml',
  '.github/workflows/*.yml',
  `${SOURCES_DIR}/*.yaml`,
  ...ACTION_PATTERNS,
  'actions/*/*/*/action.yaml',
  'actions/*/*/*/action.yml',
];

export const defaultIo: DocsIo = {
  list: scanSorted,
  async read(file) {
    try {
      return await fs.readFile(path.join(ROOT_DIR, file), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  },
  async write(file, content) {
    await fs.writeFile(path.join(ROOT_DIR, file), content, 'utf8');
  },
  async tagSha(tag) {
    return (await getTagCommitSha(tag)) ?? undefined;
  },
};

async function listAll(io: DocsIo, patterns: readonly string[]): Promise<string[]> {
  const files = await Promise.all(patterns.map((pattern) => io.list(pattern)));
  return files.flat().sort();
}

async function readJson(io: DocsIo, file: string): Promise<Record<string, unknown>> {
  const content = await io.read(file);
  if (content === undefined) {
    throw new Error(`${file} is missing`);
  }
  return JSON.parse(content) as Record<string, unknown>;
}

/** Maps each action directory to the sorted files outside it that call it. */
async function collectCallers(io: DocsIo, repoId: string): Promise<Map<string, string[]>> {
  const callers = new Map<string, string[]>();
  for (const file of await listAll(io, CALLER_PATTERNS)) {
    const content = (await io.read(file)) ?? '';
    // A generated Verify workflow repeats what its sources say; the sources are what a reader edits.
    if (content.startsWith(GENERATED_HEADER)) {
      continue;
    }
    for (const action of referencedActions(content, repoId)) {
      if (file.startsWith(`${action}/`)) {
        continue;
      }
      callers.set(action, [...(callers.get(action) ?? []), file]);
    }
  }
  return callers;
}

interface ReleaseIndex {
  versions: Record<string, unknown>;
  packages: Record<string, unknown>;
}

async function releaseOf(io: DocsIo, index: ReleaseIndex, actionPath: string): Promise<Release | undefined> {
  const entry = index.packages[actionPath] as { component?: unknown } | undefined;
  const version = index.versions[actionPath];
  if (typeof entry?.component !== 'string' || typeof version !== 'string') {
    return undefined;
  }
  const tag = consumerTag(entry.component, version);
  return { tag, sha: await io.tagSha(tag) };
}

/**
 * The release of every published action, keyed by its directory, resolved once for the whole run:
 * each README pins every published action its examples call. `undefined` before the first release.
 */
async function resolveReleases(io: DocsIo, index: ReleaseIndex): Promise<Map<string, Release | undefined>> {
  const releases = new Map<string, Release | undefined>();
  for (const actionPath of Object.keys(index.packages).filter((key) => key.startsWith('actions/'))) {
    releases.set(actionPath, await releaseOf(io, index, actionPath));
  }
  return releases;
}

/**
 * Reads and validates `docs.yaml`. A published action must have one: without it the README could not
 * say which permissions and egress the action needs.
 */
async function loadDocs(io: DocsIo, actionPath: string, manifest: ActionManifest): Promise<DocsValidation> {
  const file = `${actionPath}/${DOCS_FILE_NAME}`;
  const content = await io.read(file);
  if (content === undefined) {
    return {
      ok: false,
      problems: [`${actionPath}: has no ${DOCS_FILE_NAME}, which its README needs for permissions and egress`],
    };
  }

  let raw: unknown;
  try {
    raw = parse(content);
  } catch (error) {
    return { ok: false, problems: [`${file}: not valid YAML: ${(error as Error).message}`] };
  }

  return validateDocsFile(raw, { file, inputNames: new Set(manifest.inputs.map((input) => input.name)) });
}

async function loadExamples(
  io: DocsIo,
  model: Pick<ReadmeModel, 'repoId' | 'actionPath'>,
  docs: ActionDocs,
  releases: ReadonlyMap<string, Release | undefined>,
): Promise<{ examples: LoadedExample[]; repinned: Map<string, string>; problems: string[] }> {
  const examples: LoadedExample[] = [];
  // Example files whose pins moved, with their new content. They are written only when the action's
  // manifest, docs.yaml and every example load cleanly.
  const repinned = new Map<string, string>();
  const problems: string[] = [];
  for (const example of docs.examples) {
    const file = `${model.actionPath}/${example.file}`;
    const content = await io.read(file);
    if (content === undefined) {
      problems.push(`${model.actionPath}/${DOCS_FILE_NAME}: example ${example.file} does not exist`);
      continue;
    }
    const normalised = content.replaceAll('\r\n', '\n');
    const unsafe = unsafeExampleLine(normalised);
    if (unsafe !== undefined) {
      problems.push(`${file}: ${unsafe}`);
      continue;
    }
    // Every published action the example calls is pinned to its latest release, not only the
    // documented one. The `# tag=` comment that comes with each pin is what lets Renovate move it in
    // a workflow the example is copied into.
    const pinned = pinUses(normalised, model.repoId, (action) =>
      releases.has(action)
        ? usesReference({ repoId: model.repoId, actionPath: action, release: releases.get(action) })
        : undefined,
    );
    if (!pinned.pinned.has(model.actionPath)) {
      problems.push(`${file}: never calls ${model.actionPath}, so it documents nothing`);
      continue;
    }
    // The example file takes only pins to a commit. A tag that does not resolve yet, as on a release
    // pull request or for a new action, keeps the line the file already has rather than downgrading
    // a commit pin to the tag.
    const committed = pinUses(normalised, model.repoId, (action) => {
      const release = releases.get(action);
      return release?.sha === undefined
        ? undefined
        : usesReference({ repoId: model.repoId, actionPath: action, release });
    });
    if (committed.content !== normalised) {
      repinned.set(file, committed.content);
    }
    examples.push({ title: example.title, content: withoutRenovateComments(pinned.content) });
  }
  return { examples, repinned, problems };
}

/** A `# renovate:` annotation, on a line of its own. */
const RENOVATE_COMMENT = /^\s*# renovate:/;

/**
 * The example without its `# renovate:` annotations. They tell this repository's Renovate which
 * datasource a pinned value comes from, and mean nothing to a reader copying the example.
 */
function withoutRenovateComments(content: string): string {
  return content
    .split('\n')
    .filter((line) => !RENOVATE_COMMENT.test(line))
    .join('\n');
}

/**
 * Why an example cannot be embedded verbatim, or `undefined` when it can.
 *
 * The example lands inside a fenced block inside a marked region: a fence line would end the block
 * early, and a marker line would make the next run read the README as malformed.
 */
function unsafeExampleLine(content: string): string | undefined {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      return 'contains a Markdown code fence, which would end the README code block it is embedded in';
    }
    if (trimmed.includes('docs:generated')) {
      return 'contains a docs:generated marker, which would corrupt the README region it is embedded in';
    }
  }
  return undefined;
}

function descriptionProblems(file: string, manifest: ActionManifest): string[] {
  return [
    ...manifest.inputs
      .filter((input) => !input.description.trim())
      .map((input) => `${file}: input '${input.name}' has no description`),
    ...manifest.outputs
      .filter((output) => !output.description.trim())
      .map((output) => `${file}: output '${output.name}' has no description`),
  ];
}

/**
 * The file that holds an action's verify jobs: its source under `.github/verify/`, or, until every
 * target has moved there, its hand-written `verify-action-*` workflow.
 */
async function verifySourceOf(io: DocsIo, category: string, name: string): Promise<string | undefined> {
  const candidates = [
    `${SOURCES_DIR}/${sourceFileName(`${category}/${name}`)}`,
    `.github/workflows/verify-action-${category}-${name}.yaml`,
  ];
  for (const candidate of candidates) {
    if ((await io.read(candidate)) !== undefined) {
      return candidate;
    }
  }

  return undefined;
}

/** Generates one README into `report`. Writes nothing for an action that has an error. */
async function generateOne(
  io: DocsIo,
  repoId: string,
  manifestFile: string,
  index: ReleaseIndex,
  callers: Map<string, string[]>,
  releases: ReadonlyMap<string, Release | undefined>,
  report: GenerationReport,
): Promise<void> {
  const actionPath = path.posix.dirname(manifestFile);
  const [, category, name] = actionPath.split('/');

  // An action release-please does not know is internal, like a helper, and is not documented.
  if (!(actionPath in index.packages)) {
    return;
  }

  let manifest: ActionManifest;
  try {
    manifest = parseActionManifest((await io.read(manifestFile)) ?? '', manifestFile);
  } catch (error) {
    report.errors.push((error as Error).message);
    return;
  }

  const release = releases.get(actionPath);
  const descriptions = descriptionProblems(manifestFile, manifest);
  const loadedDocs = await loadDocs(io, actionPath, manifest);
  if (descriptions.length > 0 || !loadedDocs.ok) {
    report.errors.push(...descriptions, ...(loadedDocs.ok ? [] : loadedDocs.problems));
    return;
  }
  const { docs } = loadedDocs;

  const loaded = await loadExamples(io, { repoId, actionPath }, docs, releases);
  if (loaded.problems.length > 0) {
    report.errors.push(...loaded.problems);
    return;
  }

  const verifySource = await verifySourceOf(io, category, name);
  const regions = renderRegions({
    repoId,
    actionPath,
    manifest,
    release,
    docs,
    examples: loaded.examples,
    hasChangelog: (await io.read(`${actionPath}/CHANGELOG.md`)) !== undefined,
    verifySource,
    // The action's own verify source is linked on its own line, not counted as a caller.
    callers: (callers.get(actionPath) ?? []).filter((caller) => caller !== verifySource),
  });

  const readmeFile = `${actionPath}/README.md`;
  const existing = (await io.read(readmeFile))?.replaceAll('\r\n', '\n');
  // `undefined` leaves the README as it is.
  let next: string | undefined;
  try {
    if (existing === undefined) {
      next = newReadme(regions);
    } else if (findRegions(existing, readmeFile).length === 0) {
      report.warnings.push(`${readmeFile}: has no docs:generated regions yet, left as it is`);
    } else {
      next = spliceRegions(existing, regions, readmeFile);
    }
  } catch (error) {
    if (error instanceof MarkerError) {
      report.errors.push(error.message);
      return;
    }
    throw error;
  }

  // Written only once the README is known to generate, so a broken marker changes no file. The
  // example pins do not depend on the README, so they move even when it is left as it is.
  for (const [file, content] of loaded.repinned) {
    await io.write(file, content);
    report.written.push(file);
  }
  if (next !== undefined && next !== existing) {
    await io.write(readmeFile, next);
    report.written.push(readmeFile);
  }
}

/**
 * Generates the README of every published action.
 *
 * An action without a README gets a complete one. An action with a README gets only its marked
 * regions rewritten, and one without markers is left alone with a warning until it is migrated.
 */
export async function generateActionReadmes(repoId: string, io: DocsIo = defaultIo): Promise<GenerationReport> {
  const report: GenerationReport = { written: [], errors: [], warnings: [] };
  const index: ReleaseIndex = {
    versions: await readJson(io, MANIFEST_FILE),
    packages: ((await readJson(io, RELEASE_CONFIG_FILE)).packages ?? {}) as Record<string, unknown>,
  };
  const callers = await collectCallers(io, repoId);
  const releases = await resolveReleases(io, index);

  const seen = new Set<string>();
  for (const manifestFile of await listAll(io, ACTION_PATTERNS)) {
    const actionPath = path.posix.dirname(manifestFile);
    // GitHub reads action.yml first, so a directory with both files has one silently ignored.
    if (seen.has(actionPath)) {
      report.errors.push(`${actionPath}: has both action.yaml and action.yml; keep one`);
      continue;
    }
    seen.add(actionPath);
    await generateOne(io, repoId, manifestFile, index, callers, releases, report);
  }
  return report;
}
