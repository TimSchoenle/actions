// Works out which tags a release-please run created and waits until git can see all of them.
//
// release-please creates each release through the REST API and reports `releases_created` only once
// every call has succeeded, so the tags exist by the time a later job starts. A `git fetch` can still
// trail the API for a moment, and the docs generator pins each README to the commit its tag resolves
// to, so a tag that is not visible yet would leave that README pinned to the tag name. The wait here
// turns that gap into a short retry, and into a failure naming the tags if it does not close.

/** Pauses before each re-fetch, in milliseconds. Four retries, about 75 seconds in all. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [5_000, 10_000, 20_000, 40_000];

export interface ReleaseFiles {
  /** Parsed `release-please-config.json`. */
  config: unknown;
  /** Parsed `.release-please-manifest.json`. */
  manifest: unknown;
}

export interface TagRepository {
  /** Fetches every tag from the remote, replacing local ones that moved. */
  fetchTags(): Promise<void>;
  /** Whether the local repository has the tag. */
  hasTag(tag: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not a JSON object.`);
  }

  return value as Record<string, unknown>;
}

/**
 * Parses release-please's `paths_released` output, a JSON array of package paths.
 */
export function parseReleasedPaths(raw: string): string[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`paths_released is not JSON: ${raw}`);
  }

  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error(`paths_released is not an array of paths: ${raw}`);
  }

  return parsed;
}

/**
 * The tag release-please created for each released path: `<component>-v<version>`, the form every
 * package in this repository uses (`include-component-in-tag`, true by default).
 *
 * A path missing from the config or the manifest throws instead of being skipped: the commit being
 * released is the one these files were read from, so a gap means the inputs are wrong, and waiting
 * for a guessed tag would hide that.
 */
export function expectedReleaseTags(files: ReleaseFiles, releasedPaths: readonly string[]): string[] {
  const packages = asRecord(asRecord(files.config, 'release-please-config.json').packages, 'Its packages');
  const versions = asRecord(files.manifest, '.release-please-manifest.json');

  return releasedPaths.map((releasedPath) => {
    if (!Object.hasOwn(packages, releasedPath)) {
      throw new Error(`${releasedPath} was released but is not a package in release-please-config.json.`);
    }

    const entry = asRecord(packages[releasedPath], `The ${releasedPath} package`);
    const version = Object.hasOwn(versions, releasedPath) ? versions[releasedPath] : undefined;

    if (typeof entry.component !== 'string' || entry.component === '') {
      throw new Error(`${releasedPath} has no component in release-please-config.json.`);
    }

    // release-please defaults this to true for manifest packages, so only an explicit false changes
    // the tag name.
    if (entry['include-component-in-tag'] === false) {
      throw new Error(`${releasedPath} sets include-component-in-tag to false, which this repository does not use.`);
    }

    if (typeof version !== 'string' || version === '') {
      throw new Error(`${releasedPath} has no version in .release-please-manifest.json.`);
    }

    return `${entry.component}-v${version}`;
  });
}

async function missingTags(repository: TagRepository, tags: readonly string[]): Promise<string[]> {
  const missing: string[] = [];

  for (const tag of tags) {
    if (!(await repository.hasTag(tag))) {
      missing.push(tag);
    }
  }

  return missing;
}

/**
 * Fetches tags until every one in `tags` is present, pausing for each entry of `retryDelaysMs` in
 * turn between attempts. Throws with the names of the tags still missing after the last attempt.
 */
export async function waitForTags(
  repository: TagRepository,
  tags: readonly string[],
  retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    await repository.fetchTags();
    const missing = await missingTags(repository, tags);

    if (missing.length === 0) {
      return;
    }

    if (attempt >= retryDelaysMs.length) {
      throw new Error(`Release tags still missing after ${attempt + 1} fetches: ${missing.join(', ')}.`);
    }

    await repository.sleep(retryDelaysMs[attempt]);
  }
}
