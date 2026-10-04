/**
 * The pull request a run belongs to, read from the event payload the runner wrote.
 *
 * Read from `GITHUB_EVENT_PATH` rather than passed in as inputs, so the composite cannot be handed
 * a pull request number that disagrees with the event it is actually running for.
 *
 * Mirrors `docker/image-check`'s `pull-request.ts`, so both actions agree on what a fork is.
 */

/** The facts about the triggering pull request this action acts on. */
export interface PullRequestContext {
  readonly number: number;
  /**
   * `owner/repo` the head branch lives in, or `undefined` when GitHub reports none — the fork was
   * deleted after the pull request was opened.
   */
  readonly headRepository: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extracts the pull request from an event payload, or `undefined` for an event that has none.
 *
 * `pull_request` and `pull_request_target` both carry the object; `push`, `schedule` and
 * `workflow_dispatch` do not, and on those the action reports to the step summary alone.
 */
export function pullRequestFromEvent(payload: unknown): PullRequestContext | undefined {
  if (!isRecord(payload) || !isRecord(payload['pull_request'])) {
    return undefined;
  }

  const pullRequest = payload['pull_request'];
  const number = pullRequest['number'];

  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1) {
    return undefined;
  }

  const head = pullRequest['head'];
  const repo = isRecord(head) ? head['repo'] : undefined;
  const fullName = isRecord(repo) ? repo['full_name'] : undefined;

  return { number, headRepository: typeof fullName === 'string' ? fullName : undefined };
}

/**
 * Whether the pull request comes from another repository, whose `GITHUB_TOKEN` is read-only.
 *
 * A missing head repository counts as a fork: GitHub drops it when the fork is deleted, and a
 * deleted fork was still a fork. Treating it as same-repository would attempt the writes it exists
 * to skip.
 */
export function isFork(pullRequest: PullRequestContext, repository: string): boolean {
  return pullRequest.headRepository?.toLowerCase() !== repository.toLowerCase();
}
