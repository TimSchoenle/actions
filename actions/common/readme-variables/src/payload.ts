import { RepositoryFormatError } from './errors.js';
import { deepMerge } from './merge.js';

import type { DocEntry } from './docs.js';
import type { ManifestFacts } from './manifest.js';
import type { PayloadMap } from './merge.js';

/** Owner and name, as the `repository` input spells them. */
export interface RepositoryRef {
  owner: string;
  name: string;
}

export interface PayloadRequest {
  repository: RepositoryRef;
  branch: string;
  manifestPath: string;
  manifest: ManifestFacts;
  docs: readonly DocEntry[];
  tagPrefix: string;
  extra: PayloadMap;
}

/** `owner/name`, with neither half empty and no third segment. */
const REPOSITORY = /^([^/\s]+)\/([^/\s]+)$/;

/**
 * Splits the `repository` input.
 *
 * Validated rather than defaulted from the environment. The runner supplies it through the input's
 * `${{ github.repository }}` default, so an empty value here means a caller overrode it with
 * something empty, and rendering `https://github.com//` into every link is worse than failing.
 *
 * @throws {RepositoryFormatError} if the value is not `owner/name`.
 */
export function parseRepository(value: string): RepositoryRef {
  const match = REPOSITORY.exec(value.trim());

  if (match === null) {
    throw new RepositoryFormatError(value);
  }

  return { owner: match[1], name: match[2] };
}

/**
 * Assembles the render payload.
 *
 * Nothing here reads the network or the clock. Every value comes from a file in the checkout or from
 * an input the workflow passed, so the same commit produces the same payload on a developer's
 * machine and on a runner — which is what lets render-template's `check` mode be a merge gate rather
 * than a suggestion. A description edited in the GitHub web UI deliberately does *not* reach this:
 * the manifest is the source, and the repository's own description is set to match it.
 *
 * The derived half is built first and `extra` is merged over it, so a repository can correct any
 * fact this action got wrong without waiting for a release of the action.
 */
export function buildPayload(request: PayloadRequest): PayloadMap {
  const { repository, branch, manifest, manifestPath, docs, tagPrefix, extra } = request;
  const slug = `${repository.owner}/${repository.name}`;

  const repo: PayloadMap = {
    owner: repository.owner,
    name: repository.name,
    slug,
    branch,
    url: `https://github.com/${slug}`,
    ecosystem: manifest.kind,
    manifest: manifestPath,
  };

  // Omitted rather than emitted empty. Strict mode fails on a reference the payload does not define,
  // so a template naming `repo.description` for a manifest that has none is a red step rather than a
  // README with a blank line where its one-liner belongs.
  for (const [key, value] of [
    ['package', manifest.name],
    ['description', manifest.description],
    ['license', manifest.license],
    ['homepage', manifest.homepage],
  ] as const) {
    if (value !== undefined && value !== '') {
      repo[key] = value;
    }
  }

  const derived: PayloadMap = {
    repo,
    release: {
      version: manifest.version,
      tag: `${tagPrefix}${manifest.version}`,
    },
    toolchain: { ...manifest.toolchain },
    docs: docs.map((entry) => ({ ...entry })),
  };

  return deepMerge(derived, extra);
}

/**
 * Serializes the payload for the `variables` output.
 *
 * One line, because a workflow output is a line: a multi-line value needs the heredoc delimiter
 * protocol, and a payload carrying a newline would otherwise truncate at the first one. `JSON.stringify`
 * escapes any newline inside a *value*, so a rendered Markdown table survives this unharmed.
 */
export function serializePayload(payload: PayloadMap): string {
  return JSON.stringify(payload);
}
