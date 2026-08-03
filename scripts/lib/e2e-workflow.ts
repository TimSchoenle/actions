import path from 'node:path';

import { scanSorted } from './utils.js';

/**
 * Generator for the one-job workflow that runs an action's end-to-end cases.
 *
 * Every such workflow is the same shape — check out, set up bun, mint a token scoped to the scratch
 * repository, run `bun run e2e <action>` — so it is generated rather than copied. Fourteen
 * hand-maintained copies is fourteen chances for one to drift out of step with the pinned action
 * SHAs, the concurrency group or the permissions block.
 *
 * Actions whose cases need no credentials still get a token: the job cost is one API call, and an
 * action that grows a case reaching GitHub must not silently start failing for want of one.
 */

/** Directory under an action holding its `*.e2e.test.ts` files. */
export const E2E_DIRECTORY = 'e2e';

/** Prefix every generated workflow file shares with the hand-written verify workflows. */
export const VERIFY_WORKFLOW_PREFIX = 'verify-action-';

/** Pinned third-party actions. Renovate updates these in place, so they live in one object. */
const PINNED = {
  hardenRunner: 'step-security/harden-runner@bf7454d06d71f1098171f2acdf0cd4708d7b5920 # v2.20.0',
  checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7',
  createAppToken: 'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0',
  setupBun:
    'TimSchoenle/actions/actions/bun/setup-cached@cbdcf6fd08b46059064bc9c91efa6b610a9ee7db # tag=actions-bun-setup-cached-v1.1.10',
} as const;

/** The scratch repository every case mutates. */
const TEST_OWNER = 'TimSchoenle';
const TEST_REPO_NAME = 'actions-testing';

/** A token scope and the access level granted on it. */
export type TokenPermissions = Readonly<Record<string, 'read' | 'write'>>;

/**
 * What each action's token is allowed to do.
 *
 * `create-github-app-token` grants the installation's *entire* permission set unless at least one
 * `permission-*` input is given, so every workflow declares one explicitly — a suite that only reads
 * a YAML file must not be handed a token that can rewrite branches.
 *
 * Each entry is the union of two things: what the fixtures need to set the scene, and what the
 * action under test needs to do its job. `close-pull-request` reads `contents: write` because its
 * fixture has to create a branch and a commit before there is a pull request to close at all.
 */
const TOKEN_PERMISSIONS: Readonly<Record<string, TokenPermissions>> = {
  'actions/common/close-pull-request': { contents: 'write', 'pull-requests': 'write' },
  'actions/common/commit-changes': { contents: 'write' },
  'actions/common/create-branch': { contents: 'write' },
  'actions/common/delete-branch': { contents: 'write' },
  'actions/common/get-app-git-identity': { metadata: 'read' },
  'actions/common/setup-app-git-identity': { metadata: 'read' },
  'actions/helper/resolve-base-branch': { contents: 'write' },
  'actions/helper/verify-commit-authors': { contents: 'write', 'pull-requests': 'write' },
  'actions/maintenance/auto-approve-pr': { contents: 'write', 'pull-requests': 'write' },
  'actions/maintenance/ensure-actions-are-executed': { contents: 'write', checks: 'write' },
};

/**
 * Scope for an action whose cases never reach GitHub.
 *
 * `read-yaml`, `modify-yaml`, `render-template`, `verify-branch-name` and `apply-chart-updates` only
 * touch the filesystem. They are still handed a token so the suite fails loudly on a misconfigured
 * runner rather than skipping, but it can do nothing except identify itself.
 */
const METADATA_ONLY: TokenPermissions = { metadata: 'read' };

/** The action paths that declare their own scopes, so a contract test can spot a stale entry. */
export const DECLARED_TOKEN_SCOPES = TOKEN_PERMISSIONS;

/** The least-privilege scopes for an action's primary token. */
export function tokenPermissions(action: E2eAction): TokenPermissions {
  return TOKEN_PERMISSIONS[action.actionPath] ?? METADATA_ONLY;
}

/** Renders the `permission-*` inputs, sorted so the generated file is stable. */
function permissionInputs(permissions: TokenPermissions): string {
  return Object.keys(permissions)
    .sort()
    .map((scope) => `          permission-${scope}: ${permissions[scope]}`)
    .join('\n');
}

/** One action that has end-to-end cases, and the names its workflow is built from. */
export interface E2eAction {
  /** Category directory, e.g. `common`. */
  category: string;
  /** Action directory, e.g. `create-branch`. */
  name: string;
  /** Repository-relative action path, e.g. `actions/common/create-branch`. */
  actionPath: string;
}

/** Title-cases one path segment for a human-readable workflow name. */
function titleCase(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

/** The `name:` of the generated workflow, which `ci-required` watches by exactly this string. */
export function workflowName(action: E2eAction): string {
  return `Verify ${titleCase(action.category)} ${titleCase(action.name)}`;
}

/** The file the generated workflow is written to. */
export function workflowFileName(action: E2eAction): string {
  return `${VERIFY_WORKFLOW_PREFIX}${action.category}-${action.name}.yaml`;
}

/**
 * Whether an action's cases need a second identity.
 *
 * GitHub rejects a review submitted by the pull request's own author, so an action that approves
 * pull requests cannot be exercised by the account that opened the fixture. Only those workflows
 * mint the second token, so the extra credential is not handed to jobs with no use for it.
 */
export function needsSecondaryIdentity(action: E2eAction): boolean {
  return action.name === 'auto-approve-pr';
}

/**
 * The second identity's token, scoped to the one thing it exists to do.
 *
 * It only ever submits a review, so `pull-requests: write` alone — it must not be able to touch the
 * contents of the repository the first token already administers.
 */
function secondaryTokenStep(): string {
  return `
      - name: Generate Secondary Token
        id: secondary-token
        uses: ${PINNED.createAppToken}
        with:
          app-id: \${{ secrets.ACTIONS_TEST_BOT2_APP_ID }}
          private-key: \${{ secrets.ACTIONS_TEST_BOT2_PRIVATE_KEY }}
          owner: ${TEST_OWNER}
          repositories: ${TEST_REPO_NAME}
          permission-pull-requests: write
`;
}

/**
 * Optional file of extra jobs appended verbatim to an action's generated workflow.
 *
 * The escape hatch for the one thing this model genuinely cannot do: assert on behaviour that only
 * the runner can produce, such as an `action.yaml` default that is a `${{ }}` expression. Kept
 * beside the cases rather than in the workflow so the reason travels with the action.
 */
export const EXTRA_JOBS_FILE = 'extra-jobs.yaml';

/**
 * Job ids declared in an extra-jobs fragment, so the summary job can depend on them.
 *
 * The fragment stores its jobs at column zero — a valid standalone YAML mapping — and the generator
 * indents them on the way in. Storing them pre-indented instead put them at an indentation Prettier
 * does not consider canonical, and it silently reformatted the file to column zero anyway, which
 * turned every nested key into an apparent job id.
 */
export function extraJobIds(fragment: string): string[] {
  const ids: string[] = [];

  for (const line of fragment.split(/\r?\n/)) {
    const match = /^([a-z0-9][\w-]*):\s*$/i.exec(line);

    if (match) {
      ids.push(match[1]);
    }
  }

  return ids;
}

/** Indents a fragment's jobs to sit under the workflow's `jobs:` key. */
function indentJobs(fragment: string): string {
  return fragment
    .split(/\r?\n/)
    .map((line) => (line.trim() === '' ? '' : `  ${line}`))
    .join('\n');
}

/** Renders the complete workflow for one action. */
export function renderE2eWorkflow(action: E2eAction, extraJobs = ''): string {
  const name = workflowName(action);
  const secondary = needsSecondaryIdentity(action);
  const extraIds = extraJobIds(extraJobs);
  const needs = ['e2e', ...extraIds].map((id) => `      - ${id}`).join('\n');

  return `# GENERATED — do not edit by hand. Run \`bun run generate-e2e-workflows\` to rebuild this file
# from the actions that have an \`e2e/\` directory. The drift test in CI fails if it is out of date.
#
# The cases live in \`${action.actionPath}/${E2E_DIRECTORY}/\` and are ordinary vitest files. This
# workflow supplies only what they cannot get on a laptop: a token scoped to the scratch repository.
name: ${name}

on:
  push:
    branches:
      - main
      - 'feature/${action.actionPath.replace('actions/', '')}'
    paths:
      - '${action.actionPath}/**'
      - 'packages/e2e/**'
      - '.github/workflows/${workflowFileName(action)}'
  pull_request:
    paths:
      - '${action.actionPath}/**'
      - 'packages/e2e/**'
      - '.github/workflows/${workflowFileName(action)}'
  workflow_dispatch:

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

permissions: {}

jobs:
  e2e:
    environment:
      name: ci-e2e
      deployment: false
    name: End-to-end
    runs-on: ubuntu-latest
    permissions:
      contents: read # to fetch code
    steps:
      - name: Harden Runner
        uses: ${PINNED.hardenRunner}
        with:
          egress-policy: audit

      - name: Checkout
        uses: ${PINNED.checkout}
        with:
          persist-credentials: false

      # The cases run \`dist/index.js\`, the bundle GitHub itself would run, so nothing is built here.
      # An empty bun-version makes setup-bun fall through to bun-version-file; setup-cached defaults
      # it to 'latest', which would win otherwise.
      - name: Setup Bun
        uses: ${PINNED.setupBun}
        with:
          bun-version: ''
          bun-version-file: '.bun-version'

      - name: Generate Token
        id: token
        uses: ${PINNED.createAppToken}
        with:
          app-id: \${{ secrets.ACTIONS_TEST_BOT_APP_ID }}
          private-key: \${{ secrets.ACTIONS_TEST_BOT_PRIVATE_KEY }}
          owner: ${TEST_OWNER}
          repositories: ${TEST_REPO_NAME}
${permissionInputs(tokenPermissions(action))}
${secondary ? secondaryTokenStep() : ''}
      - name: Run End-to-end Cases
        env:
          E2E_GITHUB_TOKEN: \${{ steps.token.outputs.token }}
          # An installation token cannot call \`GET /user\`, so the suite resolves its own account by
          # app slug instead. Without this a case matching commit authors fails only in CI.
          E2E_APP_SLUG: \${{ steps.token.outputs.app-slug }}${
            secondary
              ? '\n          E2E_GITHUB_TOKEN_SECONDARY: ${{ steps.secondary-token.outputs.token }}' +
                '\n          E2E_APP_SLUG_SECONDARY: ${{ steps.secondary-token.outputs.app-slug }}'
              : ''
          }
          E2E_TEST_REPOSITORY: ${TEST_OWNER}/${TEST_REPO_NAME}
        run: bun run e2e ${action.actionPath}
${extraJobs === '' ? '' : `\n${indentJobs(extraJobs).trimEnd()}\n`}
  # <<< generated: summary (run 'bun run generate-ci-required' to update)
  summary:
    name: 'CI Summary: ${titleCase(action.category)} ${titleCase(action.name)}'
    if: \${{ always() }}
    needs:
${needs}
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - name: Fail if any verify job did not succeed
        if: \${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }}
        run: exit 1
  # >>> generated: summary
`;
}

/**
 * Every action that has end-to-end cases.
 *
 * Discovered from the filesystem rather than a list, so adding a case file is all it takes for the
 * workflow to appear. Sorted, because `Bun.Glob.scan` yields in filesystem order and the generated
 * files would otherwise churn between Windows and Linux.
 */
export async function findE2eActions(): Promise<E2eAction[]> {
  const actions: E2eAction[] = [];

  for (const file of await scanSorted(`actions/*/*/${E2E_DIRECTORY}/*.e2e.test.ts`)) {
    const [, category, name] = file.split(path.posix.sep);
    const actionPath = `actions/${category}/${name}`;

    if (!actions.some((existing) => existing.actionPath === actionPath)) {
      actions.push({ category, name, actionPath });
    }
  }

  return actions;
}

/** Path of an action's optional extra-jobs fragment. */
export function extraJobsPath(action: E2eAction): string {
  return path.join(action.actionPath, E2E_DIRECTORY, EXTRA_JOBS_FILE);
}
