import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { formatOutputs, formatSummary, parsePlanFile, readEvent, selectTargets } from './affected.js';

import type { ChangedFiles, DiffRequest, PlanEnvironment, PlanResult } from './affected.js';

/**
 * The `plan` step of `.github/workflows/verify.yaml`: reads the event, diffs with git, selects the
 * targets and writes the step outputs. No REST call is made, so planning costs no API budget.
 *
 * Node.js built-ins only, like `affected.ts`: the step runs before anything is installed.
 *
 * @packageDocumentation
 */

/** Repository-relative path of the plan file the generator writes. */
export const PLAN_FILE = '.github/verify/plan.json';

/** Runs git with arguments and returns its standard output. */
export type Git = (args: readonly string[]) => string;

/** git in `cwd`, with no pager and no prompt. */
export function gitIn(cwd: string): Git {
  return (args) =>
    execFileSync('git', ['--no-pager', ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: 64 * 1024 * 1024,
    });
}

function lines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * The files a diff request covers.
 *
 * A diff git cannot compute (a `before` a force-push discarded, a base the checkout lacks) selects
 * every target rather than none: running too much costs minutes, running too little lets a change
 * merge untested. The note says why, for the job summary.
 */
export function changedFiles(git: Git, diff: DiffRequest): { changed: ChangedFiles; note?: string } {
  switch (diff.kind) {
    case 'none': {
      return { changed: 'all' };
    }
    case 'all': {
      return { changed: 'all', note: `Every target runs: ${diff.reason}.` };
    }
    case 'range':
    case 'merge-base': {
      try {
        const from = diff.kind === 'range' ? diff.from : lines(git(['merge-base', diff.base, diff.head]))[0];
        const to = diff.kind === 'range' ? diff.to : diff.head;
        if (from === undefined) {
          throw new Error('git merge-base printed nothing');
        }
        return { changed: lines(git(['diff', '--name-only', '--no-renames', from, to])) };
      } catch (error) {
        return {
          changed: 'all',
          note: `Every target runs: git could not compute the changed files (${(error as Error).message.split('\n')[0]}).`,
        };
      }
    }
  }
}

/** Plans a run from the environment, the plan file and git. */
export function plan(
  env: PlanEnvironment,
  root: string,
  git: Git = gitIn(root),
): { result: PlanResult; changed: ChangedFiles; note?: string } {
  const planFile = parsePlanFile(fs.readFileSync(path.join(root, PLAN_FILE), 'utf8'));
  const { event, diff } = readEvent(env);
  const { changed, note } = changedFiles(git, diff);

  return { result: selectTargets(planFile, event, changed), changed, ...(note === undefined ? {} : { note }) };
}

/** Entry point: plans, then appends to `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` when they are set. */
export function main(env: NodeJS.ProcessEnv = process.env, root = process.cwd()): PlanResult {
  const { result, changed, note } = plan(
    {
      EVENT_NAME: env['EVENT_NAME'],
      BASE_REF: env['BASE_REF'],
      BASE_SHA: env['BASE_SHA'],
      HEAD_SHA: env['HEAD_SHA'],
      REF: env['REF'],
      BEFORE: env['BEFORE'],
      AFTER: env['AFTER'],
    },
    root,
  );
  const summary = formatSummary(result, changed, note);

  if (env['GITHUB_OUTPUT']) {
    fs.appendFileSync(env['GITHUB_OUTPUT'], formatOutputs(result));
  }
  if (env['GITHUB_STEP_SUMMARY']) {
    fs.appendFileSync(env['GITHUB_STEP_SUMMARY'], summary);
  }
  console.log(summary);

  return result;
}
