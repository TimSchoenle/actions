import fs from 'node:fs';
import path from 'node:path';

import chalk from 'chalk';

import {
  DEFAULT_BRANCH,
  findRequiredCheckProblems,
  FORBIDDEN_REQUIRED_CHECKS,
  parseWorkflow,
  REQUIRED_CHECKS,
  type RequiredCheckProblem,
} from './lib/required-checks.js';
import { ROOT_DIR } from './lib/utils.js';

// Reconciles the in-repo required-checks manifest with the ruleset GitHub actually enforces.
//
// The contract test in scripts/__tests__/required-checks.test.ts proves each *listed* context is
// produced unconditionally, but it cannot see the ruleset. This script closes that gap, and needs a
// `gh` login with `repo` scope. It is deliberately not wired into CI: rulesets are read through an
// endpoint that a pull request's GITHUB_TOKEN cannot reach, so it is a maintenance command.
//
//   bun run check-required-checks            # report drift, exit non-zero when there is any
//   bun run check-required-checks -- --apply # rewrite the ruleset to match the manifest
//
// `--apply` only ever replaces the `required_status_checks` rule, and refuses outright when the
// manifest itself is unsound — the point is to make the reviewed list authoritative, not to make
// branch protection editable from a terminal on a whim. Run it only after the workflows producing
// the listed contexts are on the default branch: a context required before it exists blocks every
// open pull request.

const WORKFLOWS_DIR = path.join(ROOT_DIR, '.github', 'workflows');
const STATUS_CHECK_RULE = 'required_status_checks';

interface RulesetStatusCheck {
  context: string;
  /** The app permitted to report the context. Omitted means any source may. */
  integration_id?: number;
}

interface RulesetRule {
  type: string;
  parameters?: { required_status_checks?: RulesetStatusCheck[] };
}

interface Ruleset {
  id: number;
  name: string;
  target: string;
  enforcement: string;
  conditions?: { ref_name?: { include?: string[] } };
  bypass_actors?: unknown[];
  rules?: RulesetRule[];
}

function gh<T>(args: readonly string[], body?: unknown): T {
  // Bun-only: the script is invoked through `bun run`, never imported by the vitest suite.
  const result = Bun.spawnSync(['gh', 'api', ...args], {
    stdin: body === undefined ? 'ignore' : new TextEncoder().encode(JSON.stringify(body)),
  });
  if (result.exitCode !== 0) {
    throw new Error(`gh api ${args.join(' ')} failed: ${new TextDecoder().decode(result.stderr).trim()}`);
  }
  return JSON.parse(new TextDecoder().decode(result.stdout)) as T;
}

/** The branch rulesets that target the default branch, fetched in full. */
function defaultBranchRulesets(): Ruleset[] {
  const summaries = gh<Ruleset[]>(['repos/{owner}/{repo}/rulesets']);

  return summaries
    .filter((summary) => summary.target === 'branch')
    .map((summary) => gh<Ruleset>([`repos/{owner}/{repo}/rulesets/${summary.id}`]))
    .filter((ruleset) => ruleset.conditions?.ref_name?.include?.includes('~DEFAULT_BRANCH') === true);
}

/** Contexts the default-branch rulesets mark required, as GitHub reports them. */
export function enforcedContexts(rulesets: readonly { rules?: RulesetRule[] }[]): string[] {
  const contexts = new Set<string>();

  for (const ruleset of rulesets) {
    for (const rule of ruleset.rules ?? []) {
      for (const check of rule.parameters?.[STATUS_CHECK_RULE] ?? []) {
        contexts.add(check.context);
      }
    }
  }

  return [...contexts].sort();
}

/**
 * The manifest's contexts as ruleset entries, each keeping the `integration_id`
 * the context already carried. A brand new context inherits the id the existing
 * entries agree on; a ruleset whose entries disagree is left for a human, since
 * guessing the wrong app silently accepts a status from anyone.
 */
export function reconcileStatusChecks(current: readonly RulesetStatusCheck[]): RulesetStatusCheck[] {
  const byContext = new Map(current.map((check) => [check.context, check]));
  const ids = new Set(current.map((check) => check.integration_id));
  const fallback = ids.size === 1 ? [...ids][0] : undefined;

  return REQUIRED_CHECKS.map((check) => {
    const existing = byContext.get(check.context);
    if (existing !== undefined) {
      return existing;
    }
    if (fallback === undefined) {
      throw new Error(
        `Cannot add '${check.context}': the ruleset's existing checks name more than one integration_id, so there is no unambiguous one to reuse. Add it in the GitHub UI instead.`,
      );
    }
    return { context: check.context, integration_id: fallback };
  });
}

function applyManifest(rulesets: readonly Ruleset[]): void {
  const targets = rulesets.filter((ruleset) => (ruleset.rules ?? []).some((rule) => rule.type === STATUS_CHECK_RULE));

  if (targets.length !== 1) {
    throw new Error(
      `Expected exactly one default-branch ruleset with a '${STATUS_CHECK_RULE}' rule, found ${targets.length}.`,
    );
  }

  const ruleset = targets[0]!;
  const rules = (ruleset.rules ?? []).map((rule) =>
    rule.type === STATUS_CHECK_RULE
      ? {
          ...rule,
          parameters: {
            ...rule.parameters,
            [STATUS_CHECK_RULE]: reconcileStatusChecks(rule.parameters?.[STATUS_CHECK_RULE] ?? []),
          },
        }
      : rule,
  );

  gh(['-X', 'PUT', `repos/{owner}/{repo}/rulesets/${ruleset.id}`, '--input', '-'], {
    name: ruleset.name,
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    conditions: ruleset.conditions,
    bypass_actors: ruleset.bypass_actors ?? [],
    rules,
  });

  console.log(chalk.green(`Updated ruleset '${ruleset.name}' to the ${REQUIRED_CHECKS.length} contexts it lists.`));
}

function readWorkflow(file: string): string | undefined {
  const filePath = path.join(WORKFLOWS_DIR, file);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
}

/** Structural problems with the manifest itself, independent of the ruleset. */
export function manifestProblems(): RequiredCheckProblem[] {
  const problems: RequiredCheckProblem[] = [];

  for (const check of REQUIRED_CHECKS) {
    const forbidden = FORBIDDEN_REQUIRED_CHECKS[check.context];
    if (forbidden !== undefined) {
      problems.push({ context: check.context, reason: forbidden });
      continue;
    }
    const content = readWorkflow(check.workflow);
    problems.push(
      ...findRequiredCheckProblems(check, content === undefined ? undefined : parseWorkflow(content), content),
    );
  }

  return problems;
}

export function main(argv: string[] = Bun.argv.slice(2)): void {
  const apply = argv.includes('--apply');

  // An unsound manifest is a hard stop in both modes: reporting it as drift would invite someone to
  // "fix" it by writing a context that can never gate anything into branch protection.
  const problems = manifestProblems();
  for (const problem of problems) {
    console.error(chalk.red(`unsound  ${problem.context}: ${problem.reason}`));
  }
  if (problems.length > 0) {
    console.error(chalk.red('\nFix scripts/lib/required-checks.ts before touching the ruleset.'));
    process.exit(1);
  }

  const rulesets = defaultBranchRulesets();
  if (apply) {
    applyManifest(rulesets);
    return;
  }

  const expected = REQUIRED_CHECKS.map((check) => check.context).sort();
  const enforced = enforcedContexts(rulesets);
  const missing = expected.filter((context) => !enforced.includes(context));
  const extra = enforced.filter((context) => !expected.includes(context));

  for (const context of missing) {
    console.error(chalk.red(`missing  ${context}: in the manifest but not required on ${DEFAULT_BRANCH}.`));
  }
  for (const context of extra) {
    const known = FORBIDDEN_REQUIRED_CHECKS[context];
    console.error(chalk.red(`extra    ${context}: required on ${DEFAULT_BRANCH} but not in the manifest.`));
    if (known !== undefined) {
      console.error(chalk.yellow(`         ${known}`));
    }
  }

  if (missing.length > 0 || extra.length > 0) {
    console.error(
      chalk.red(
        '\nRequired checks are out of sync. Once every listed context is produced on ' +
          `${DEFAULT_BRANCH}, run 'bun run check-required-checks -- --apply'.`,
      ),
    );
    process.exit(1);
  }

  console.log(chalk.green(`Required checks are in sync (${expected.length} contexts on ${DEFAULT_BRANCH}).`));
}

if (import.meta.main) {
  main();
}
