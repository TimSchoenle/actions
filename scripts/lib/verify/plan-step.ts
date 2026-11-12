import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_BRANCH,
  formatOutputs,
  formatSummary,
  jobChanges,
  parsePlanFile,
  readEvent,
  selectTargets,
} from './affected.js';
import { checkRunsLookup, verifiedMergedHead } from './merged-head.js';

import type { ChangedFiles, DiffRequest, PlanEnvironment, PlanEvent, PlanFile, PlanResult } from './affected.js';
import type { CheckRunsLookup } from './merged-head.js';

/**
 * The `plan` step of `.github/workflows/verify.yaml`: reads the event, diffs with git, selects the
 * targets and writes the step outputs. Only a push to `main` whose tree equals a pull request head
 * makes a REST call, one, to confirm that head passed Verify ({@link verifiedMergedHead}).
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
 * Splits `git -z` output on NUL. Each name is kept exactly as committed: without `-z` git quotes a
 * name with a non-ASCII byte (`"docs/\\303\\244.md"`), which then matches no input, and trimming would
 * change a name that starts or ends with a space.
 */
function nulSeparated(output: string): string[] {
  return output.split('\0').filter((name) => name !== '');
}

/**
 * The files a diff request covers.
 *
 * A diff git cannot compute (a `before` a force-push discarded, a base the checkout lacks) selects
 * every target rather than none: running too much costs minutes, running too little lets a change
 * merge untested. The note says why, for the job summary.
 */
export function changedFiles(git: Git, diff: DiffRequest): { changed: ChangedFiles; note?: string; base?: string } {
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
        return { changed: nulSeparated(git(['diff', '--name-only', '-z', '--no-renames', from, to])), base: from };
      } catch (error) {
        return {
          changed: 'all',
          note: `Every target runs: git could not compute the changed files (${firstLine(error)}).`,
        };
      }
    }
  }
}

function firstLine(error: unknown): string {
  return (error as Error).message.split('\n')[0] ?? '';
}

/**
 * The plan file as the base commit has it, or `undefined` with the reason when it cannot be read or
 * parsed, in which case every target counts as changed.
 */
export function basePlan(git: Git, base: string): { plan?: PlanFile; note?: string } {
  try {
    return { plan: parsePlanFile(git(['show', `${base}:${PLAN_FILE}`])) };
  } catch (error) {
    return { note: `Every target runs: the base plan could not be read (${firstLine(error)}).` };
  }
}

/** The lockfile whose hash keys the dependency cache the install job saves. */
const LOCKFILE = 'bun.lock';

/** A push to `main` that can only land a tree a pull request verified, as the `from..to` it pushed. */
function mergeToMain(event: PlanEvent, diff: DiffRequest): { from: string; to: string } | undefined {
  return event.name === 'push' && event.branch === DEFAULT_BRANCH && diff.kind === 'range'
    ? { from: diff.from, to: diff.to }
    : undefined;
}

/**
 * Plans a run from the environment, the plan file and git.
 *
 * A push to `main` whose tree a pull request head already verified selects nothing; the install job
 * still runs when the push changed the lockfile, so pull requests find the new dependency cache.
 * Without a `lookup` every push plans as usual.
 */
export async function plan(
  env: PlanEnvironment,
  root: string,
  git: Git = gitIn(root),
  lookup?: CheckRunsLookup,
): Promise<{ result: PlanResult; changed: ChangedFiles; note?: string }> {
  const planFile = parsePlanFile(fs.readFileSync(path.join(root, PLAN_FILE), 'utf8'));
  const { event, diff } = readEvent(env);
  const { changed, note: diffNote, base } = changedFiles(git, diff);

  const push = mergeToMain(event, diff);
  let mergeNote: string | undefined;
  if (push !== undefined && lookup !== undefined) {
    const merged = await verifiedMergedHead(git, lookup, push);
    if (merged.verified) {
      return {
        result: {
          targets: [],
          shards: [],
          buildDirs: [],
          install: false,
          seedCache: changed === 'all' || changed.includes(LOCKFILE),
        },
        changed,
        note: `Nothing runs: the pushed tree is the head of #${merged.pullRequest}, which passed Verify.`,
      };
    }
    mergeNote = `Targets are selected as usual: ${merged.reason}.`;
  }

  const { plan: previous, note: baseNote } =
    changed === 'all' || base === undefined ? { plan: planFile } : basePlan(git, base);
  const notes = [mergeNote, diffNote ?? baseNote].filter((text) => text !== undefined);

  return {
    result: selectTargets(planFile, event, changed, jobChanges(planFile, previous)),
    changed,
    ...(notes.length === 0 ? {} : { note: notes.join(' ') }),
  };
}

/** The check-runs lookup for a push to `main`, or `undefined` when the step was given no token. */
function lookupFrom(env: NodeJS.ProcessEnv): CheckRunsLookup | undefined {
  const token = env['CHECKS_TOKEN'];
  const repository = env['GITHUB_REPOSITORY'];
  if (!token || !repository) {
    return undefined;
  }

  return checkRunsLookup({ apiUrl: env['GITHUB_API_URL'] || 'https://api.github.com', repository, token });
}

/** Entry point: plans, then appends to `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` when they are set. */
export async function main(env: NodeJS.ProcessEnv = process.env, root = process.cwd()): Promise<PlanResult> {
  const { result, changed, note } = await plan(
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
    gitIn(root),
    lookupFrom(env),
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
