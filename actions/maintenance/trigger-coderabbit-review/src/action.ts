import { parsePullRequestUrl, quoteForLog, runAction } from 'actions-util';
import * as core from 'actions-util/core';

import { ActionInput, ActionOutput, getBooleanInput, getInput, setOutput } from './generated/action-io.js';
import { createTriggerApi } from './github-api.js';
import { parseCommand, parseLogins, triggerReview } from './trigger.js';
import { readEventPayload, resolveWorkflowRun } from './workflow-run.js';

import type { TriggerApi } from './github-api.js';
import type { SkipReason } from './trigger.js';
import type { WorkflowRunSkipReason } from './workflow-run.js';
import type { PullRequestCoordinates } from 'actions-util';

/** Human-readable explanation of each skip reason, for the run log. */
const SKIP_MESSAGES: Record<SkipReason | WorkflowRunSkipReason, string> = {
  'bot-author': 'the pull request was opened by a bot account',
  closed: 'the pull request is not open',
  draft: 'the pull request is a draft',
  fork: 'the head branch lives in a fork',
  'no-pull-request': 'the triggering run belongs to no pull request into the base branch',
  'not-pull-request': 'the triggering run was not started by a pull_request event',
  'other-base': 'the pull request targets another base branch',
  outdated: 'the head of the pull request moved after the triggering run; the run for the new head asks again',
  'skipped-author': 'the pull request author is listed in skip_authors',
  'already-reviewed': 'CodeRabbit already reviewed the head commit',
  'already-requested': 'a review of the head commit was already requested and has not failed',
};

/** A pull request to act on, with the head commit the review was asked for when that is known. */
interface ResolvedPullRequest {
  /** Base branch the pull request must target, or empty for any. */
  baseBranch: string;
  pullRequest: PullRequestCoordinates;
  headSha?: string;
}

/** The pull request to act on: from `pr_url` when it is set, otherwise from a `workflow_run` event. */
type Target = { kind: 'pull-request'; target: ResolvedPullRequest } | { kind: 'skip'; reason: WorkflowRunSkipReason };

/**
 * Resolves the pull request from `pr_url`, or, when it is empty, from the event of the
 * `workflow_run` that started this job.
 *
 * @throws when `pr_url` is empty outside a `workflow_run` job, or the event cannot be read.
 */
function resolveTarget(prUrl: string, baseBranch: string, env: NodeJS.ProcessEnv): Target {
  if (prUrl !== '') {
    return { kind: 'pull-request', target: { baseBranch, pullRequest: parsePullRequestUrl(prUrl) } };
  }

  const eventPath = env['GITHUB_EVENT_PATH'] ?? '';
  if (env['GITHUB_EVENT_NAME'] !== 'workflow_run' || eventPath === '') {
    throw new Error('pr_url is required outside a workflow_run job.');
  }

  return resolveWorkflowRun(readEventPayload(eventPath), env['GITHUB_REPOSITORY'] ?? '', baseBranch);
}

/** Publishes a skip with its reason. */
function reportSkip(target: string, reason: SkipReason | WorkflowRunSkipReason): void {
  core.info(`Skipping ${target}: ${SKIP_MESSAGES[reason]}.`);
  setOutput(ActionOutput.triggered, 'false');
  setOutput(ActionOutput.skip_reason, reason);
  setOutput(ActionOutput.comment_url, '');
  setOutput(ActionOutput.collapsed_comments, '0');
}

/**
 * Reads the action inputs, posts the CodeRabbit command when no skip rule applies and publishes the
 * outcome.
 *
 * Every input is validated before the first API call, so a typo in `command` fails the step without
 * touching the pull request.
 *
 * @param api - injection seam for tests; defaults to the GitHub REST API bound to `token`.
 */
export function run(api?: TriggerApi): Promise<void> {
  return runAction(async () => {
    const token = getInput(ActionInput.token, { required: true });
    const command = parseCommand(getInput(ActionInput.command, { required: true }));
    const resolved = resolveTarget(getInput(ActionInput.pr_url), getInput(ActionInput.base_branch), process.env);
    const skipDrafts = getBooleanInput(ActionInput.skip_drafts);
    const skipBots = getBooleanInput(ActionInput.skip_bots);
    const rejectForks = getBooleanInput(ActionInput.reject_forks);
    const skipAuthors = parseLogins(getInput(ActionInput.skip_authors));
    const skipDuplicates = getBooleanInput(ActionInput.skip_duplicates);
    const collapseOutdated = getBooleanInput(ActionInput.collapse_outdated);

    if (resolved.kind === 'skip') {
      reportSkip('the triggering run', resolved.reason);
      return;
    }

    const { baseBranch, headSha, pullRequest } = resolved.target;
    const outcome = await triggerReview(api ?? createTriggerApi(token), {
      baseBranch,
      collapseOutdated,
      command,
      expectedHeadSha: headSha,
      pullRequest,
      rejectForks,
      skipAuthors,
      skipBots,
      skipDrafts,
      skipDuplicates,
    });

    const target = `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`;

    if (!outcome.triggered) {
      reportSkip(target, outcome.skipReason);
      return;
    }

    core.info(
      `Posted ${quoteForLog(`@coderabbitai ${command}`)} on ${target} as ${quoteForLog(outcome.actor)}: ${outcome.comment.url}`,
    );
    setOutput(ActionOutput.triggered, 'true');
    setOutput(ActionOutput.skip_reason, '');
    setOutput(ActionOutput.comment_url, outcome.comment.url);

    const { collapsed, failures } = outcome.collapse;
    if (collapsed > 0) {
      core.info(`Collapsed ${collapsed} outdated comment(s).`);
    }
    for (const failure of failures) {
      core.warning(`Could not collapse an outdated comment: ${failure}`);
    }
    setOutput(ActionOutput.collapsed_comments, String(collapsed));
  });
}
