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

/**
 * Pinned actions, in one object because Renovate has to find them here.
 *
 * This file is the source of truth for every generated workflow, and it is TypeScript, so no
 * built-in Renovate manager sees it. Three `customManagers` in `renovate.json` do, and they only
 * work on refs written in exactly this shape: a single-quoted literal starting with the owner, a
 * 40-character digest, then ` # ` and either a `vX.Y.Z` tag or `tag=<component>-vX.Y.Z` for an
 * internal one. `renovate-managers.test.ts` fails any entry the managers would silently skip —
 * which otherwise looks like nothing at all, an action quietly frozen at the version it was added.
 *
 * Renovate updates every occurrence of the same dependency at the same version in one branch, so a
 * bump lands here and in the generated workflows together and the drift check stays satisfied.
 */
export const PINNED = {
  hardenRunner: 'step-security/harden-runner@05e31511f85b41b11d1cf0ef85d0992719546e2c # v2.21.0',
  checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
  createAppToken: 'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0',
  setupBun:
    'TimSchoenle/actions/actions/bun/setup-cached@cbdcf6fd08b46059064bc9c91efa6b610a9ee7db # tag=actions-bun-setup-cached-v1.1.10',
  // Used only by the test job, which must not install anything. Kept at the same versions
  // `setup-cached` pins internally, because the two halves have to agree on the cache format.
  setupBunOnly: 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0',
  cache: 'actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0',
  cacheRestore: 'actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0',
} as const;

/** The scratch repository every case mutates. */
const TEST_OWNER = 'TimSchoenle';
const TEST_REPO_NAME = 'actions-testing';

/**
 * Endpoints every generated job needs whatever else it does.
 *
 * `github.com` fetches the checkout and the tarball of every action a job `uses`;
 * `objects.githubusercontent.com` is where a GitHub release download redirects, which is how bun
 * itself arrives. The cache pair is the service and the blob storage it hands off to.
 */
const BASE_ENDPOINTS: readonly string[] = [
  'github.com:443',
  'objects.githubusercontent.com:443',
  '*.actions.githubusercontent.com:443',
  '*.blob.core.windows.net:443',
];

/**
 * The install job's extra reach: the package registry, and nothing else.
 *
 * This job holds no token and touches no repository. It exists so that the registry appears in
 * exactly one job's allowlist, and it is not the job that runs the tests.
 */
export const INSTALL_ALLOWED_ENDPOINTS: readonly string[] = [...BASE_ENDPOINTS, 'registry.npmjs.org:443'];

/**
 * The test job's reach: the GitHub API, and nothing else.
 *
 * The point of splitting the two is here. This job is the one that holds a repository-scoped app
 * token, so it is the one whose egress matters — and it has no path to a package registry at all.
 * A dependency that tried to phone home during `vitest` would be blocked rather than audited, and
 * a `postinstall` cannot run here because nothing is installed here.
 *
 * `harden-runner` cannot change policy mid-job, which is why this is a second job rather than a
 * second step: an allowlist is only as narrow as the widest thing the job does.
 */
export const E2E_ALLOWED_ENDPOINTS: readonly string[] = [...BASE_ENDPOINTS, 'api.github.com:443'];

/** Renders a harden-runner step with the allowlist for one job, indented to sit under `steps:`. */
function hardenRunnerStep(endpoints: readonly string[]): string {
  const rendered = endpoints.map((endpoint) => `            ${endpoint}`).join('\n');

  return `      - name: Harden Runner
        uses: ${PINNED.hardenRunner}
        with:
          egress-policy: block
          allowed-endpoints: >
${rendered}`;
}

/**
 * Every directory `bun install` populates, and so everything the test job needs restored.
 *
 * A bun workspace does not hoist all dependencies to the root. `@actions/core` lives in
 * `packages/ts-util/node_modules`, and each action under `actions/` keeps its own tree the same way;
 * the root holds only what is shared. `setup-cached` caches `<working-directory>/node_modules` and
 * nothing else, which is enough to make an install faster — it installs afterwards regardless — but
 * not enough to reconstitute a tree on its own. The test job never installs, so restoring the root
 * alone leaves every workspace dependency missing, and that surfaces as `ERR_MODULE_NOT_FOUND` from
 * inside a package rather than as anything resembling a cache failure.
 *
 * This is therefore the generator's own cache, keyed separately from the one `setup-cached` keeps.
 *
 * The same list is rendered into the job that saves and the job that restores, and it has to be the
 * *same string*, not an equivalent one: `actions/cache` hashes this input verbatim into the entry's
 * version and returns a cache only when the key and that version both match, so `node_modules` and
 * `./node_modules` are two different caches under one key. `e2e-contract.test.ts` asserts the two
 * generated halves agree.
 */
const WORKSPACE_MODULES: readonly string[] = ['node_modules', 'packages/*/node_modules', 'actions/*/*/node_modules'];

/** Renders the multi-line `path:` input both cache steps share, indented to sit under `with:`. */
function cachePathsInput(): string {
  return ['          path: |', ...WORKSPACE_MODULES.map((pattern) => `            ${pattern}`)].join('\n');
}

/**
 * The job that installs dependencies, so the job that runs the tests does not have to.
 *
 * The key is computed once here and published, rather than recomputed downstream: two copies of a
 * `hashFiles` expression are two chances to disagree, and a disagreement here surfaces as a cache
 * miss the test job cannot recover from, because it may not install anything.
 *
 * The cache step precedes the install so that a hit is a restore rather than a download, and saves
 * in its post step only when the key was missing. It has to sit in this job and not the next one:
 * writing the cache is the half that needs a populated tree, and populating one needs the registry.
 */
function installJob(): string {
  return `  install:
    name: Install Dependencies
    runs-on: ubuntu-latest
    permissions:
      contents: read # to fetch code
    outputs:
      cache-key: \${{ steps.key.outputs.value }}
    steps:
${hardenRunnerStep(INSTALL_ALLOWED_ENDPOINTS)}

      - name: Checkout
        uses: ${PINNED.checkout}
        with:
          persist-credentials: false

      - name: Compute Cache Key
        id: key
        env:
          CACHE_KEY: e2e-workspace-modules-\${{ runner.os }}-\${{ hashFiles('bun.lock') }}
        run: echo "value=$CACHE_KEY" >> "$GITHUB_OUTPUT"

      - name: Cache Workspace Dependencies
        uses: ${PINNED.cache}
        with:
${cachePathsInput()}
          key: \${{ steps.key.outputs.value }}

      # An empty bun-version makes setup-bun fall through to bun-version-file; setup-cached defaults
      # it to 'latest', which would win otherwise. It reinstalls on every run whatever the cache did,
      # which is what validates the restored tree against the lockfile before the next job trusts it.
      - name: Setup Bun And Install
        uses: ${PINNED.setupBun}
        with:
          bun-version: ''
          bun-version-file: '.bun-version'
`;
}

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
 * indents them on the way in. Storing them pre-indented instead put them at an indentation the
 * formatter does not consider canonical, and it silently reformatted the file to column zero
 * anyway, which turned every nested key into an apparent job id.
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

/**
 * Refs a fragment may reach, keyed as {@link PINNED} names them.
 *
 * A `Map` rather than an index into `PINNED`, so a key read out of a file on disk cannot address
 * anything but a pin.
 */
const PIN_BY_KEY: ReadonlyMap<string, string> = new Map(Object.entries(PINNED));

/**
 * The only form a fragment may use to reach an action it does not own: `uses: pinned:<key>`.
 *
 * A fragment is copied into the generated workflow verbatim, so a `uses:` written out in full there
 * is a *second* pin for an action `PINNED` already carries — and one no manager in `renovate.json`
 * can see, because those read this file alone. Renovate then bumps the generated copy on its own,
 * the drift check fails, and the regenerate job answers by reverting the bump, so the update can
 * never land. Naming a key instead keeps one pin per action, in the one place Renovate looks.
 *
 * `renovate-managers.test.ts` fails a fragment that writes a ref out in full.
 */
const PIN_PLACEHOLDER = /^(\s*uses:[ \t]*)pinned:(\w+)[ \t]*$/gm;

/**
 * Substitutes a fragment's `pinned:<key>` placeholders with the refs from {@link PINNED}.
 *
 * Throws rather than passing an unresolved placeholder through: `uses: pinned:foo` is not a valid
 * action reference, and a workflow carrying one fails only once a runner has reached that job.
 */
export function resolvePins(fragment: string): string {
  return fragment.replaceAll(PIN_PLACEHOLDER, (_match, prefix: string, key: string) => {
    const pin = PIN_BY_KEY.get(key);

    if (pin === undefined) {
      throw new Error(
        `Unknown pin 'pinned:${key}' in an extra-jobs fragment. Add the action to PINNED in ` +
          `scripts/lib/e2e-workflow.ts, or name one of: ${[...PIN_BY_KEY.keys()].join(', ')}.`,
      );
    }

    return `${prefix}${pin}`;
  });
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
  const resolvedExtraJobs = resolvePins(extraJobs);
  const extraIds = extraJobIds(resolvedExtraJobs);
  // `install` is in the summary's needs as well as `e2e`'s: a failed install leaves `e2e` *skipped*,
  // and a summary that only watched `e2e` would read that absence as nothing having gone wrong.
  const needs = ['install', 'e2e', ...extraIds].map((id) => `      - ${id}`).join('\n');

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
${installJob()}
  e2e:
    needs: install
    environment:
      name: ci-e2e
      deployment: false
    name: End-to-end
    runs-on: ubuntu-latest
    permissions:
      contents: read # to fetch code
    steps:
${hardenRunnerStep(E2E_ALLOWED_ENDPOINTS)}

      - name: Checkout
        uses: ${PINNED.checkout}
        with:
          persist-credentials: false

      # setup-bun rather than setup-cached: the cached wrapper runs \`bun install\` on every job, cache
      # hit or not, and this job is the one that must have no route to a package registry at all.
      - name: Setup Bun
        uses: ${PINNED.setupBunOnly}
        with:
          bun-version-file: '.bun-version'

      # Restored, never installed, and never saved. \`fail-on-cache-miss\` is what keeps that honest:
      # without it a miss would leave the suite to fail later on a missing import, several confusing
      # minutes further on.
      - name: Restore Dependencies
        uses: ${PINNED.cacheRestore}
        with:
${cachePathsInput()}
          key: \${{ needs.install.outputs.cache-key }}
          fail-on-cache-miss: true

      # The cases run \`dist/index.js\`, the bundle GitHub itself would run, so nothing is built here.
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
${resolvedExtraJobs === '' ? '' : `\n${indentJobs(resolvedExtraJobs).trimEnd()}\n`}
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
