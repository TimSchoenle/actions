import { extractReleaseNotes } from './changelog.js';
import { parseManifest, parseReleaseConfig, releasePleaseTag } from './config.js';

import type { PackageSettings } from './config.js';
import type { AssociatedPullRequest, ReleaseStateApi } from './github.js';

/** What the plan is evaluated against. */
export interface PlanOptions {
  readonly sha: string;
  readonly configFile: string;
  readonly manifestFile: string;
  readonly sourceTagPrefix: string;
  readonly consumerTagPattern: RegExp;
  /** `undefined` accepts a release pull request from any author. */
  readonly releasePrAuthorId: number | undefined;
  readonly pendingLabel: string;
}

/** One release of one package, as `publish-build-commit` takes it. */
export interface PlannedRelease {
  readonly path: string;
  readonly component: string | undefined;
  readonly version: string;
  /** The tag consumers pin: the release-please tag without the source prefix. */
  readonly consumerTag: string;
  /** The tag release-please finds the previous release by. */
  readonly sourceTag: string;
  /** `<consumer component>: v<version>`, or `v<version>` for a package without a component. */
  readonly releaseName: string;
  readonly notes: string;
}

/** The outcome of `plan` mode. */
export type Plan =
  | { readonly isRelease: false; readonly reason: string }
  | { readonly isRelease: true; readonly pullRequest: number; readonly releases: readonly PlannedRelease[] };

/** A git ref name GitHub accepts as a tag, without `/` so it can also name a notes file. */
function isSafeTagName(name: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name) && !name.includes('..') && !name.endsWith('.') && !name.endsWith('.lock')
  );
}

/**
 * The consumer tag for a release-please tag.
 *
 * @throws an `Error` when the release-please tag lacks the source prefix, or the consumer tag fails
 * the pattern or is not a safe tag name
 */
export function consumerTagFor(
  sourceTag: string,
  options: Pick<PlanOptions, 'sourceTagPrefix' | 'consumerTagPattern'>,
): string {
  if (!sourceTag.startsWith(options.sourceTagPrefix)) {
    throw new Error(
      `release-please tags this package ${sourceTag}, which does not start with ${JSON.stringify(options.sourceTagPrefix)}. ` +
        'Give its component the source tag prefix.',
    );
  }
  const consumerTag = sourceTag.slice(options.sourceTagPrefix.length);
  if (!isSafeTagName(consumerTag) || !options.consumerTagPattern.test(consumerTag)) {
    throw new Error(`Consumer tag ${JSON.stringify(consumerTag)} does not match ${options.consumerTagPattern.source}.`);
  }

  return consumerTag;
}

function releaseName(settings: PackageSettings, version: string, prefix: string): string {
  return settings.component === undefined
    ? `v${version}`
    : `${settings.component.slice(settings.component.startsWith(prefix) ? prefix.length : 0)}: v${version}`;
}

async function readRequired(api: ReleaseStateApi, file: string, ref: string): Promise<string> {
  const text = await api.fileAt(file, ref);
  if (text === undefined) {
    throw new Error(`${file} does not exist at ${ref}.`);
  }

  return text;
}

/**
 * Checks that every package has the source tag of its manifest version.
 *
 * Run before release-please: a missing source tag sends release-please looking for the previous
 * release through the whole history, which proposes every commit as unreleased.
 *
 * @returns the source tags checked
 * @throws an `Error` listing every missing tag
 */
export async function preflight(api: ReleaseStateApi, options: PlanOptions): Promise<string[]> {
  const packages = parseReleaseConfig(await readRequired(api, options.configFile, options.sha), options.configFile);
  const versions = parseManifest(await readRequired(api, options.manifestFile, options.sha), options.manifestFile);
  const expected = packages.map((settings) => {
    const version = versions.get(settings.path);
    if (version === undefined) {
      throw new Error(`${options.manifestFile} has no version for ${settings.path}.`);
    }
    const tag = releasePleaseTag(settings, version);
    consumerTagFor(tag, options);

    return tag;
  });
  // One lookup per package by name, so the cost follows the number of packages, not of tags.
  const tags = await api.existingTags(expected);
  const missing = expected.filter((tag) => !tags.has(tag));
  if (missing.length > 0) {
    throw new Error(`Missing source tags (${missing.length}): ${missing.join(', ')}.`);
  }

  return expected;
}

/** The release pull request `sha` merged, or the reason there is none. */
function findReleasePullRequest(
  pulls: readonly AssociatedPullRequest[],
  defaultBranch: string,
  options: PlanOptions,
): AssociatedPullRequest | string {
  const merged = pulls.filter(
    (pull) => pull.mergedAt !== null && pull.mergeCommitSha === options.sha && pull.baseRef === defaultBranch,
  );
  const pending = merged.filter((pull) => pull.labels.includes(options.pendingLabel));
  if (pending.length === 0) {
    return `${options.sha} merges no pull request labelled ${JSON.stringify(options.pendingLabel)} into ${defaultBranch}.`;
  }
  if (pending.length > 1) {
    throw new Error(
      `${options.sha} is the merge commit of several pending pull requests: ${pending.map((p) => `#${p.number}`).join(', ')}.`,
    );
  }
  const [pull] = pending;
  if (options.releasePrAuthorId !== undefined && pull.authorId !== options.releasePrAuthorId) {
    throw new Error(
      `Pull request #${pull.number} is labelled ${JSON.stringify(options.pendingLabel)} but was opened by user ` +
        `${String(pull.authorId)}, not the release author ${options.releasePrAuthorId}.`,
    );
  }

  return pull;
}

/**
 * Decides whether `sha` is a release and, if so, plans every release it makes.
 *
 * A release is the merge commit of a merged pull request into the default branch that carries the
 * pending label (and comes from the configured author). Its releases are the manifest entries that
 * changed between the commit's first parent and the commit; each gets its tags, name and notes.
 *
 * @throws an `Error` for a pending pull request from another author, several pending pull requests,
 * or a configuration, manifest or changelog that does not describe the release
 */
export async function plan(api: ReleaseStateApi, options: PlanOptions): Promise<Plan> {
  const pull = findReleasePullRequest(await api.pullRequestsForCommit(options.sha), await api.defaultBranch(), options);
  if (typeof pull === 'string') {
    return { isRelease: false, reason: pull };
  }

  const [parent] = await api.commitParents(options.sha);
  if (parent === undefined) {
    throw new Error(`${options.sha} has no parent to compare the manifest with.`);
  }
  const before = parseManifest(await readRequired(api, options.manifestFile, parent), options.manifestFile);
  const after = parseManifest(await readRequired(api, options.manifestFile, options.sha), options.manifestFile);
  const changed = [...after].filter(([path, version]) => before.get(path) !== version);
  if (changed.length === 0) {
    return { isRelease: false, reason: `Pull request #${pull.number} changes no version in ${options.manifestFile}.` };
  }

  const packages = new Map(
    parseReleaseConfig(await readRequired(api, options.configFile, options.sha), options.configFile).map((settings) => [
      settings.path,
      settings,
    ]),
  );
  const releases: PlannedRelease[] = [];
  for (const [path, version] of changed) {
    const settings = packages.get(path);
    if (settings === undefined) {
      throw new Error(`${options.manifestFile} changes ${path}, which ${options.configFile} does not configure.`);
    }
    const sourceTag = releasePleaseTag(settings, version);
    releases.push({
      path,
      component: settings.component,
      version,
      consumerTag: consumerTagFor(sourceTag, options),
      sourceTag,
      releaseName: releaseName(settings, version, options.sourceTagPrefix),
      notes: extractReleaseNotes(
        await readRequired(api, settings.changelogPath, options.sha),
        version,
        settings.changelogPath,
      ),
    });
  }

  return {
    isRelease: true,
    pullRequest: pull.number,
    releases: releases.sort((a, b) => (a.consumerTag < b.consumerTag ? -1 : a.consumerTag > b.consumerTag ? 1 : 0)),
  };
}
