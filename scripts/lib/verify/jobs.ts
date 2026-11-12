import fs from 'node:fs';
import path from 'node:path';

import { sortedUnique, workspacePackages } from 'action-graph';

import { PINNED } from './pins.js';

import type { Permission } from '../action-docs/docs-file.js';
import type { E2eSettings, TokenPermissions, VerifySource } from './source.js';

/**
 * The jobs the generator writes itself into `verify.yaml`: `plan`, `install`, `build`, and one job per
 * group of end-to-end suites that share token scopes. Rendered as text, indented to sit under a `jobs:` key.
 *
 * @packageDocumentation
 */

/** The scratch repository every case mutates. */
export const TEST_OWNER = 'TimSchoenle';
export const TEST_REPO_NAME = 'actions-testing';

/**
 * Endpoints every generated job needs whatever else it does.
 *
 * `github.com` fetches the checkout and the tarball of every action a job `uses`;
 * `objects.githubusercontent.com` is where a GitHub release download redirects, which is how bun
 * itself arrives. The cache pair is the service and the blob storage it hands off to.
 */
export const BASE_ENDPOINTS: readonly string[] = [
  'github.com:443',
  'objects.githubusercontent.com:443',
  '*.actions.githubusercontent.com:443',
  '*.blob.core.windows.net:443',
];

/**
 * The install job's extra reach: the package registry, and nothing else.
 *
 * This job holds no token and touches no repository. It exists so that the registry appears in
 * exactly one job's allowlist, and it is not a job that runs tests.
 */
/**
 * The plan job's extra reach: the API, for the one check-runs call a push to `main` makes. The pull
 * request head it fetches comes from `github.com`, like the checkout.
 */
export const PLAN_ALLOWED_ENDPOINTS: readonly string[] = [...BASE_ENDPOINTS, 'api.github.com:443'];

export const INSTALL_ALLOWED_ENDPOINTS: readonly string[] = [...BASE_ENDPOINTS, 'registry.npmjs.org:443'];

/**
 * The end-to-end job's reach: the GitHub API, and nothing else.
 *
 * This job holds a repository-scoped App token, so it is the one whose egress matters, and it has no
 * path to a package registry at all. `harden-runner` cannot change policy mid-job, which is why the
 * install is a separate job rather than a step: an allowlist is only as narrow as the widest thing the
 * job does.
 */
export const E2E_ALLOWED_ENDPOINTS: readonly string[] = [...BASE_ENDPOINTS, 'api.github.com:443'];

/** The hosts an artifact download reaches; a job that installs the built actions must allow them. */
export const ARTIFACT_ENDPOINTS: readonly string[] = [
  '*.actions.githubusercontent.com:443',
  '*.blob.core.windows.net:443',
];

/** The allowlist of a target's end-to-end job: the GitHub API only when the job holds a token. */
export function e2eEndpoints(source: VerifySource): readonly string[] {
  const base = source.e2e?.tokenPermissions === undefined ? BASE_ENDPOINTS : E2E_ALLOWED_ENDPOINTS;

  return [...base, ...(source.e2e?.extraEndpoints ?? [])];
}

/**
 * Renders a harden-runner step with the allowlist for one job, indented to sit under `steps:`.
 *
 * @param disableSudo - for a job that holds a secret while it runs code under test: without sudo or a
 * container runtime that code cannot reach past the runner user to the runner's own memory or files.
 */
function hardenRunnerStep(endpoints: readonly string[], disableSudo = false): string {
  const rendered = endpoints.map((endpoint) => `            ${endpoint}`).join('\n');

  return `      - name: Harden Runner
        uses: ${PINNED.hardenRunner}
        with:
          egress-policy: block${disableSudo ? '\n          disable-sudo-and-containers: true' : ''}
          allowed-endpoints: >
${rendered}`;
}

/**
 * Every directory `bun install` populates, and so everything a job that never installs needs restored.
 *
 * A bun workspace does not hoist all dependencies to the root: `@octokit/core` lives in
 * `packages/ts-util/node_modules`, and each action keeps its own tree the same way. Restoring the root
 * alone leaves every workspace dependency missing, which surfaces as `ERR_MODULE_NOT_FOUND` from inside
 * a package rather than as anything resembling a cache failure.
 *
 * The job that saves and the jobs that restore must render this as the *same string*: `actions/cache`
 * hashes the `path` input verbatim into the entry's version, so `node_modules` and `./node_modules`
 * are two different caches under one key.
 *
 * Each package directory becomes its top-level directory, one `*` segment per remaining segment, then
 * `node_modules`. The root `node_modules` comes first.
 */
export function workspaceModulePaths(packageDirectories: Iterable<string>): string[] {
  const patterns = [...packageDirectories].map((directory) => {
    const [top, ...rest] = directory.split('/');

    return [top, ...rest.map(() => '*'), 'node_modules'].join('/');
  });

  return ['node_modules', ...sortedUnique(patterns)];
}

/**
 * The directories of this repository's bun workspace members: every package under a top-level
 * directory the root `workspaces` globs name.
 */
export function workspaceMemberDirectories(root: string): string[] {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { workspaces?: unknown };
  const globs = Array.isArray(manifest.workspaces) ? manifest.workspaces.filter((g) => typeof g === 'string') : [];
  const tops = new Set(globs.map((glob) => glob.split('/')[0]));

  return [...workspacePackages(root).values()].filter((directory) => tops.has(directory.split('/')[0]));
}

/** Renders the multi-line `path:` input every cache step shares, indented to sit under `with:`. */
function cachePathsInput(modulePaths: readonly string[]): string {
  return ['          path: |', ...modulePaths.map((pattern) => `            ${pattern}`)].join('\n');
}

/** Renders the `permission-*` inputs of an App token step, sorted so the generated file is stable. */
function permissionInputs(permissions: TokenPermissions): string {
  return Object.keys(permissions)
    .sort()
    .map((scope) => `          permission-${scope}: ${permissions[scope]}`)
    .join('\n');
}

/**
 * The plan job: selects the affected targets from the changed files, with git and the plan file.
 *
 * It needs the history to find the merge base of a pull request and the `before` of a push. A
 * blobless clone carries every commit and tree, which is all `git diff --name-only` reads, without
 * downloading a single file it does not check out.
 */
export function planJob(): string {
  return `  plan:
    name: Plan
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read # to fetch code and history
      checks: read # to confirm a merged pull request head passed Verify
    outputs:
      targets: \${{ steps.plan.outputs.targets }}
      shards: \${{ steps.plan.outputs.shards }}
      install: \${{ steps.plan.outputs.install }}
      seed-cache: \${{ steps.plan.outputs.seed-cache }}
      build: \${{ steps.plan.outputs.build }}
      build-dirs: \${{ steps.plan.outputs.build-dirs }}
      e2e-groups: \${{ steps.plan.outputs.e2e-groups }}
      e2e: \${{ steps.plan.outputs.e2e }}
    steps:
${hardenRunnerStep(PLAN_ALLOWED_ENDPOINTS)}

      - name: Checkout
        uses: ${PINNED.checkout}
        with:
          persist-credentials: false
          fetch-depth: 0
          filter: blob:none

      - name: Setup Bun
        uses: ${PINNED.setupBunOnly}
        with:
          bun-version-file: '.bun-version'

      # Imports nothing but Node.js built-ins, so it runs without an install.
      - name: Select Affected Targets
        id: plan
        env:
          EVENT_NAME: \${{ github.event_name }}
          BASE_REF: \${{ github.base_ref }}
          BASE_SHA: \${{ github.event.pull_request.base.sha }}
          HEAD_SHA: \${{ github.event.pull_request.head.sha }}
          REF: \${{ github.ref }}
          BEFORE: \${{ github.event.before }}
          AFTER: \${{ github.event.after }}
          # Only a push to main reads a check run; no other event gets the token.
          CHECKS_TOKEN: \${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && github.token || '' }}
        run: bun scripts/verify-plan.ts
`;
}

/**
 * The job that installs dependencies once, so no job that runs tests has to.
 *
 * The key is computed once here and handed on, rather than recomputed downstream: two copies of a
 * `hashFiles` expression are two chances to disagree, and a disagreement surfaces as a cache miss the
 * test jobs cannot recover from, because they may not install anything.
 */
export function installJob(modulePaths: readonly string[]): string {
  return `  install:
    name: Install Dependencies
    needs: plan
    # Only when a selected target reads the tree: one with end-to-end cases or a build. A run whose
    # targets are all hand-written jobs that set themselves up skips it rather than waiting on it.
    # seed-cache: a push to main that selects nothing but changes bun.lock still saves the cache.
    if: \${{ needs.plan.outputs.install == 'true' || needs.plan.outputs.seed-cache == 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 10
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
${cachePathsInput(modulePaths)}
          key: \${{ steps.key.outputs.value }}

      # An empty bun-version makes setup-bun fall through to bun-version-file; setup-cached defaults
      # it to 'latest', which would win otherwise. It reinstalls on every run whatever the cache did,
      # which is what validates the restored tree against the lockfile before the next job trusts it.
      # cache-mode none: the step above already restores and saves this tree under the key the test
      # jobs read, and setup-cached's own cache of the same 313 MB was a second restore and save.
      - name: Setup Bun And Install
        uses: ${PINNED.setupBun}
        with:
          bun-version: ''
          bun-version-file: '.bun-version'
          cache-mode: none
`;
}

/**
 * The job that builds every bundle the selected targets run, once, from the commit under test.
 *
 * It restores the install job's tree and builds with no registry in reach, which also proves the build
 * needs no network. One build per run is what makes the artifact name unique: a name cannot be reused
 * within a run, and every job downloads by the ID in the outputs, never by name.
 */
export function buildJob(modulePaths: readonly string[]): string {
  return `  build:
    name: Build Actions
    needs: [plan, install]
    if: \${{ needs.plan.outputs.build == 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read # to fetch code
    outputs:
      artifact-id: \${{ steps.build.outputs.artifact-id }}
      manifest-sha256: \${{ steps.build.outputs.manifest-sha256 }}
    steps:
${hardenRunnerStep(BASE_ENDPOINTS)}

      - name: Checkout
        uses: ${PINNED.checkout}
        with:
          persist-credentials: false

      - name: Setup Bun
        id: bun
        uses: ${PINNED.setupBunOnly}
        with:
          bun-version-file: '.bun-version'

      - name: Restore Dependencies
        uses: ${PINNED.cacheRestore}
        with:
${cachePathsInput(modulePaths)}
          key: \${{ needs.install.outputs.cache-key }}
          fail-on-cache-miss: true

      - name: Build Actions
        id: build
        uses: ${PINNED.buildActions}
        with:
          build-dirs: \${{ needs.plan.outputs.build-dirs }}
          build-command: bun run build
          artifact-name: built-actions-\${{ github.run_attempt }}
          toolchain: bun \${{ steps.bun.outputs.bun-version }}
`;
}

/**
 * The suites that share one end-to-end job: every source with the same token scopes, primary and
 * secondary, or every source with no token. One job runs all of its selected suites, so a run mints
 * one token per scope set rather than one per suite, and restores the dependency cache once.
 */
export interface E2eGroup {
  /** The job id in `verify.yaml`: `e2e-tokenless`, or `e2e-` and the scopes. */
  readonly id: string;
  /** The job's display name. */
  readonly title: string;
  readonly tokenPermissions?: TokenPermissions;
  readonly secondaryTokenPermissions?: TokenPermissions;
  /** The union of the members' allowlists, in first-seen order. */
  readonly endpoints: readonly string[];
  /** The member targets, sorted. */
  readonly targets: readonly string[];
}

/** The longest a group job may run, whatever its size. */
const MAX_GROUP_TIMEOUT_MINUTES = 60;

function sortedScopes(permissions: TokenPermissions): [string, string][] {
  return Object.entries(permissions).sort(([a], [b]) => a.localeCompare(b));
}

function scopeSlug(permissions: TokenPermissions): string {
  return sortedScopes(permissions)
    .map(([scope, access]) => `${scope}-${access}`)
    .join('-');
}

function scopeList(permissions: TokenPermissions): string {
  return sortedScopes(permissions)
    .map(([scope, access]) => `${scope} ${access}`)
    .join(', ');
}

/** The id of the group job that runs a suite with these settings. */
export function e2eGroupId(settings: E2eSettings): string {
  const primary = settings.tokenPermissions;
  if (primary === undefined) {
    return 'e2e-tokenless';
  }
  const secondary = settings.secondaryTokenPermissions;

  return `e2e-${scopeSlug(primary)}${secondary === undefined ? '' : `-as-${scopeSlug(secondary)}`}`;
}

function groupTitle(settings: E2eSettings): string {
  const primary = settings.tokenPermissions;
  if (primary === undefined) {
    return 'End-to-end (no token)';
  }
  const secondary = settings.secondaryTokenPermissions;

  return `End-to-end (${scopeList(primary)}${secondary === undefined ? '' : `; acting as ${scopeList(secondary)}`})`;
}

/** Groups the sources with an `e2e` block by token scopes, sorted by group id. */
export function e2eGroups(sources: readonly VerifySource[]): E2eGroup[] {
  const members = new Map<string, VerifySource[]>();
  for (const source of sources) {
    if (source.e2e !== undefined) {
      const id = e2eGroupId(source.e2e);
      members.set(id, [...(members.get(id) ?? []), source]);
    }
  }

  return [...members.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, group]) => {
      const settings = group[0].e2e as E2eSettings;

      return {
        id,
        title: groupTitle(settings),
        ...(settings.tokenPermissions === undefined ? {} : { tokenPermissions: settings.tokenPermissions }),
        ...(settings.secondaryTokenPermissions === undefined
          ? {}
          : { secondaryTokenPermissions: settings.secondaryTokenPermissions }),
        endpoints: [...new Set(group.flatMap((source) => e2eEndpoints(source)))],
        targets: group.map((source) => source.target).sort(),
      };
    });
}

/** The token step of a second identity. */
function secondaryTokenStep(permissions: TokenPermissions): string {
  return `
      - name: Generate Secondary Token
        id: secondary-token
        uses: ${PINNED.createAppToken}
        with:
          client-id: \${{ secrets.ACTIONS_TEST_BOT2_APP_ID }}
          private-key: \${{ secrets.ACTIONS_TEST_BOT2_PRIVATE_KEY }}
          owner: ${TEST_OWNER}
          repositories: ${TEST_REPO_NAME}
${permissionInputs(permissions)}
`;
}

/** The token steps and the environment of the cases' run step, for a suite that reaches GitHub. */
function tokenSteps(permissions: TokenPermissions, secondary: TokenPermissions | undefined): string {
  return `      # The cases run \`dist/index.js\`, the bundle GitHub itself would run: the one the install step
      # above put there, which the harness checks against BUILT_ACTIONS_MANIFEST before it runs it.
      - name: Generate Token
        id: token
        uses: ${PINNED.createAppToken}
        with:
          client-id: \${{ secrets.ACTIONS_TEST_BOT_APP_ID }}
          private-key: \${{ secrets.ACTIONS_TEST_BOT_PRIVATE_KEY }}
          owner: ${TEST_OWNER}
          repositories: ${TEST_REPO_NAME}
${permissionInputs(permissions)}
${secondary === undefined ? '' : secondaryTokenStep(secondary)}`;
}

/** The `env:` of the run step: the token and the scratch repository, or the tokenless flag. */
function runEnvironment(settings: Pick<E2eGroup, 'tokenPermissions' | 'secondaryTokenPermissions'>): string {
  if (settings.tokenPermissions === undefined) {
    // No token was minted, so the setup must not insist on one. ScratchRepo still does, so a case
    // that starts reaching GitHub fails here instead of passing without credentials.
    return `          E2E_TOKENLESS: '1'`;
  }

  const secondary = settings.secondaryTokenPermissions;

  return `          E2E_GITHUB_TOKEN: \${{ steps.token.outputs.token }}
          # An installation token cannot call \`GET /user\`, so the suite resolves its own account by
          # app slug instead. Without this a case matching commit authors fails only in CI.
          E2E_APP_SLUG: \${{ steps.token.outputs.app-slug }}${
            secondary === undefined
              ? ''
              : '\n          E2E_GITHUB_TOKEN_SECONDARY: ${{ steps.secondary-token.outputs.token }}' +
                '\n          E2E_APP_SLUG_SECONDARY: ${{ steps.secondary-token.outputs.app-slug }}'
          }
          E2E_TEST_REPOSITORY: ${TEST_OWNER}/${TEST_REPO_NAME}`;
}

/**
 * The `verify.yaml` job that runs the selected suites of one {@link E2eGroup}: `bun run e2e` with one
 * directory per selected member, which the plan job lists under the group id.
 *
 * A group with token scopes gets one token scoped to the scratch repository, minted in the `ci-e2e`
 * environment. The tokenless group gets neither: no App key, no environment and no route to the
 * GitHub API, because a job that holds the key while it runs code under test exposes the key.
 *
 * It restores the install job's tree and never installs, so the job has no route to a package
 * registry. It installs the shared build whenever the run built one.
 */
export function e2eGroupJob(group: E2eGroup, modulePaths: readonly string[]): string {
  const permissions = group.tokenPermissions;
  const environment =
    permissions === undefined
      ? ''
      : `    environment:
      name: ci-e2e
      deployment: false
`;
  const timeout = Math.min(MAX_GROUP_TIMEOUT_MINUTES, 15 + 5 * (group.targets.length - 1));

  return `  ${group.id}:
    name: ${group.title}
    needs: [plan, install, build]
    # Like a shard call: once the shared install and build succeeded or were skipped, and only when
    # the plan selected a suite of this group.
    if: \${{ !cancelled() && (needs.install.result == 'success' || needs.install.result == 'skipped') && (needs.build.result == 'success' || needs.build.result == 'skipped') && contains(fromJSON(needs.plan.outputs.e2e-groups), '${group.id}') }}
${environment}    runs-on: ubuntu-latest
    timeout-minutes: ${timeout}
    permissions:
      contents: read # to fetch code
    steps:
${hardenRunnerStep(group.endpoints, permissions !== undefined)}

      - name: Checkout
        uses: ${PINNED.checkout}
        with:
          persist-credentials: false

      # Installs the bundles the build job built from this commit; dist/ is not committed. A run that
      # selected no target with a bundle built nothing, and the suites run no bundle.
      - name: Install Built Actions
        if: \${{ needs.build.outputs.artifact-id != '' }}
        uses: ${PINNED.installBuiltActions}
        with:
          artifact-id: \${{ needs.build.outputs.artifact-id }}
          expected-manifest-sha256: \${{ needs.build.outputs.manifest-sha256 }}

      # setup-bun rather than setup-cached: the cached wrapper runs \`bun install\` on every job, cache
      # hit or not, and this job is the one that must have no route to a package registry at all.
      - name: Setup Bun
        uses: ${PINNED.setupBunOnly}
        with:
          bun-version-file: '.bun-version'

      # The harness runs a node24 bundle with the first node on PATH and refuses any other major,
      # and the image's default node is not 24. A major alone resolves from the runner's tool
      # cache, so this reaches no endpoint the allowlist above does not already carry.
      - name: Setup Node
        uses: ${PINNED.setupNode}
        with:
          node-version: '24'

      # Restored, never installed, and never saved. \`fail-on-cache-miss\` is what keeps that honest:
      # without it a miss would leave the suites to fail later on a missing import.
      - name: Restore Dependencies
        uses: ${PINNED.cacheRestore}
        with:
${cachePathsInput(modulePaths)}
          key: \${{ needs.install.outputs.cache-key }}
          fail-on-cache-miss: true
${permissions === undefined ? '' : `\n${tokenSteps(permissions, group.secondaryTokenPermissions)}`}
      # One directory per selected suite. The trailing slash keeps actions/a/b from also matching
      # actions/a/b-c, since vitest filters by substring.
      - name: Run End-to-end Cases
        env:
          E2E_DIRECTORIES: \${{ toJSON(fromJSON(needs.plan.outputs.e2e)['${group.id}']) }}
${runEnvironment(group)}
        run: |
          set -euo pipefail
          mapfile -t directories < <(jq -r '.[] + "/"' <<< "$E2E_DIRECTORIES")
          bun run e2e "\${directories[@]}"
`;
}

/**
 * The scopes of the token the action under test receives: the secondary token when there is one,
 * since the second identity is the one the action runs as.
 */
export function actionTokenPermissions(source: VerifySource): TokenPermissions {
  return source.e2e?.secondaryTokenPermissions ?? source.e2e?.tokenPermissions ?? {};
}

/**
 * The `docs.yaml` permissions an end-to-end token does not cover.
 *
 * The suite's token is not derived from `docs.yaml`: `docs.yaml` says what a caller must grant; the
 * token says what the cases need on the scratch repository. They overlap in one place: the cases hand
 * the action a token through its token input, so a scope documented on a token input is one the cases
 * exercise, and a token without it is drift. Job-token entries are ignored; conditional entries count
 * as if their condition held; `write` covers `read`.
 */
export function missingTokenInputScopes(granted: TokenPermissions, documented: readonly Permission[]): Permission[] {
  return documented.filter((permission) => {
    if (permission.token === undefined) {
      return false;
    }
    const level = granted[permission.scope];

    return level === undefined || (permission.access === 'write' && level !== 'write');
  });
}
