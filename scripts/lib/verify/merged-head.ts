/**
 * Recognises a push to `main` whose tree a pull request already verified.
 *
 * The repository merges by squash only and requires a branch to be up to date before it merges, so the
 * squash commit's tree is the tree of the pull request head, and the required `Verify` check already
 * ran on that head. Re-running every affected target on `main` verifies the same tree a second time.
 *
 * Every condition fails safe: when anything cannot be established, the push plans as usual.
 *
 * Node.js built-ins only, like `affected.ts`: the plan step runs before anything is installed.
 *
 * @packageDocumentation
 */

import type { Git } from './plan-step.js';

/** The name of the required check: the summary job of `verify.yaml` on `pull_request`. */
export const VERIFY_CHECK_NAME = 'Verify';

/**
 * The GitHub Actions app. Only its check runs count, so no other app that can write checks can satisfy
 * the lookup with a check of the same name.
 */
export const GITHUB_ACTIONS_APP_ID = 15_368;

/** The state of one check run, as the check-runs endpoint reports it. */
export interface CheckRun {
  readonly status: string;
  readonly conclusion: string | null;
}

/** Reads the latest `Verify` check runs of a commit. */
export type CheckRunsLookup = (sha: string) => Promise<readonly CheckRun[]>;

/** Whether the pushed tree is a verified pull request head, and if not, why not. */
export type MergedHead =
  | { readonly verified: true; readonly pullRequest: number }
  | { readonly verified: false; readonly reason: string };

const LOOKUP_TIMEOUT_MS = 30_000;

/**
 * The pull request number a squash subject ends with, as GitHub writes it: `Subject (#123)`.
 *
 * Only a trailing reference counts; one inside the subject names some other pull request.
 */
export function pullRequestNumber(subject: string): number | undefined {
  const match = /\(#([1-9]\d*)\)$/.exec(subject.trimEnd());

  return match === null ? undefined : Number(match[1]);
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';
}

/**
 * The head of the pull request the pushed commit names, when its tree is the pushed tree and it
 * contains the commit `main` was at before the push.
 *
 * Containing `from` is what makes the pull request's own run cover the whole push: its changed files
 * were diffed from a merge base no older than `from`, so no change between the two went unselected.
 */
function matchingHead(git: Git, from: string, to: string): { head: string; pullRequest: number } | { reason: string } {
  const pullRequest = pullRequestNumber(git(['log', '-1', '--format=%s', to]).trim());
  if (pullRequest === undefined) {
    return { reason: 'the pushed commit names no pull request' };
  }

  git(['fetch', '--no-tags', '--quiet', 'origin', `refs/pull/${pullRequest}/head`]);
  const head = git(['rev-parse', '--verify', 'FETCH_HEAD^{commit}']).trim();
  const tree = (commit: string): string => git(['rev-parse', '--verify', `${commit}^{tree}`]).trim();
  if (tree(head) !== tree(to)) {
    return { reason: `the pushed tree differs from the head of #${pullRequest}` };
  }
  if (git(['merge-base', from, head]).trim() !== from) {
    return { reason: `the head of #${pullRequest} does not contain the previous commit on main` };
  }

  return { head, pullRequest };
}

/**
 * Decides whether a push of `from..to` to `main` only lands a tree a pull request already verified.
 *
 * Tree equality alone is not enough: an administrator can merge past a failing or missing check. So
 * the latest `Verify` check run on the pull request head must have completed with success.
 */
export async function verifiedMergedHead(
  git: Git,
  lookup: CheckRunsLookup,
  push: { readonly from: string; readonly to: string },
): Promise<MergedHead> {
  let match: ReturnType<typeof matchingHead>;
  try {
    match = matchingHead(git, push.from, push.to);
  } catch (error) {
    return { verified: false, reason: `git could not read the pull request head (${firstLine(error)})` };
  }
  if ('reason' in match) {
    return { verified: false, reason: match.reason };
  }

  const { head, pullRequest } = match;
  let runs: readonly CheckRun[];
  try {
    runs = await lookup(head);
  } catch (error) {
    return { verified: false, reason: `the Verify check of #${pullRequest} could not be read (${firstLine(error)})` };
  }
  if (runs.length === 0) {
    return { verified: false, reason: `the head of #${pullRequest} has no Verify check` };
  }
  if (!runs.every((run) => run.status === 'completed' && run.conclusion === 'success')) {
    return { verified: false, reason: `Verify did not succeed on the head of #${pullRequest}` };
  }

  return { verified: true, pullRequest };
}

/** Where and as whom the check-runs endpoint is called. */
export interface CheckRunsOptions {
  readonly apiUrl: string;
  readonly repository: string;
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Reads the latest check runs named {@link VERIFY_CHECK_NAME} that GitHub Actions attached to a
 * commit, with one REST call.
 *
 * @throws an `Error` for a response that is not a success or has no `check_runs` array
 */
export function checkRunsLookup(options: CheckRunsOptions): CheckRunsLookup {
  const request = options.fetch ?? globalThis.fetch;

  return async (sha) => {
    const url = new URL(`${options.apiUrl}/repos/${options.repository}/commits/${sha}/check-runs`);
    url.searchParams.set('check_name', VERIFY_CHECK_NAME);
    url.searchParams.set('app_id', String(GITHUB_ACTIONS_APP_ID));
    url.searchParams.set('filter', 'latest');
    url.searchParams.set('per_page', '100');

    const response = await request(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${options.token}`,
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`the check-runs request returned ${response.status}`);
    }

    const body = (await response.json()) as { check_runs?: unknown };
    if (!Array.isArray(body.check_runs)) {
      throw new Error('the check-runs response has no check_runs array');
    }

    return body.check_runs.map((run: { status?: unknown; conclusion?: unknown }) => ({
      status: String(run.status),
      conclusion: typeof run.conclusion === 'string' ? run.conclusion : null,
    }));
  };
}
