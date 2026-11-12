# Verify pipeline

How this repository verifies its actions: one workflow, `Verify`, runs the jobs of every target a
change affects. The workflow is generated; humans edit one source file per target under
[`.github/verify/`](../.github/verify), and `bun run generate-verify` writes the rest.

## Contents

- [Files](#files)
- [Jobs](#jobs)
- [Source format](#source-format)
- [Selecting targets](#selecting-targets)
- [Limits](#limits)
- [Runbook](#runbook)

## Files

| File                                             | Written by | Holds                                                                     |
| ------------------------------------------------ | ---------- | ------------------------------------------------------------------------- |
| `.github/verify/<category>-<name>.yaml`          | people     | one target: its jobs, and what the dependency graph cannot see            |
| `.github/workflows/verify.yaml`                  | generator  | the triggers, `plan`, `install`, `build`, one call per shard, the summary |
| `.github/workflows/verify-<category>[-<n>].yaml` | generator  | a reusable workflow with the jobs of one category's targets (a shard)     |
| `.github/verify/plan.json`                       | generator  | each target's inputs, build directories and rules, for `plan`             |
| `scripts/lib/verify/pins.ts`                     | people     | the pinned action refs; Renovate reads them there                         |

The sources live outside `actions/`. release-please counts every file below an action's directory
as a change to that action, so a test-only edit there would cut a release. The end-to-end cases
themselves stay in `actions/<category>/<name>/e2e/`.

Scripts CI fails while a generated file differs from what the generator writes.

## Jobs

| Job                 | Runs when                                         | Does                                                                                       |
| ------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `plan`              | always                                            | diffs with git, selects the affected targets, the shards to call and the build list        |
| `install`           | a selected target has end-to-end cases or a build | installs the workspace once and saves the dependency cache; the only job with the registry |
| `build`             | a selected target runs a bundle                   | builds the union of the selected targets' build directories with `release/build-actions`   |
| `verify-<category>` | the shard holds a selected target                 | calls the shard; each of its jobs runs only when its target is selected                    |
| `verify`            | always                                            | fails when any job above failed or was cancelled                                           |

A shard call waits on `install` and `build` and accepts either as skipped. A target with neither
end-to-end cases nor build directories runs only hand-written jobs that set themselves up, so a run
that selects only such targets skips `install` instead of waiting on it; the plan sets `install`
whenever any selected target reads the tree.

The `verify` job reports as `Verify`, the one verify context branch protection requires
(`scripts/lib/required-checks.ts`), on `pull_request` runs only. Push, schedule and dispatch runs
report as `Verify (<event>)`: a push to a `feature/**` branch attaches its check to the same commit as
the pull request, and under the same name a push that selected nothing would report a vacuous success
there. The pull request's own copy of the workflow decides it, as it
does for `Lint & Test`. Never require a shard call or a job inside a shard: those report under nested
names while they run, and not at all when their target is not selected.

A shard receives `targets`, `cache-key`, `artifact-id` and `manifest-sha256` as inputs, and only the
secrets its jobs read. Its caller job grants the union of its jobs' permissions: a called workflow
can narrow its token, never widen it.

## Source format

```yaml
target: common/find-patch # <category>/<name>; the file is common-find-patch.yaml
title: Common Find-patch # optional; derived from the target
e2e: # present when actions/<target>/e2e/ has cases; e2e: {} for none of the keys below
  token-permissions: { metadata: read } # only when the cases use ScratchRepo; always explicit
  secondary-token-permissions: {} # optional: a second App identity; needs token-permissions
  extra-endpoints: [] # optional: hosts beyond the base allowlist; never a registry
build: [] # optional: action directories to build beyond those derived
extra-inputs: [] # optional: paths the graph cannot see, e.g. test data
rules: # optional
  pull-request-branches: [main] # base branches a pull request must target
  push-branches: [] # pushes that run the target besides main; default feature/<target>
  schedule: false # whether the weekly schedule runs it
jobs: # ordinary workflow jobs
  find-patch-composite: ...
```

With an `e2e` block the generator adds a job `e2e-<category>-<name>` that runs
`bun run e2e actions/<target>`.

With `token-permissions`, the job runs in the `ci-e2e` environment, mints a token scoped to the scratch
repository and may reach `api.github.com`. Without it, the job holds no App key, uses no environment,
cannot reach the GitHub API, and runs with `E2E_TOKENLESS=1`, which lets the suite start without
credentials. A job that mints a token holds the App's private key while it runs code under test, so a
suite gets a token if and only if its cases reference `ScratchRepo` or `E2E_GITHUB_TOKEN`, and
`scripts/__tests__/verify-contract.test.ts` enforces that both ways. A case that starts using
`ScratchRepo` in a tokenless suite fails at once, because `ScratchRepo` still insists on credentials.

The generator changes a source job in two ways only: it prefixes the display name with the title,
and it prepends `contains(fromJSON(inputs.targets), '<target>')` to the `if:`, keeping an existing
condition in parentheses so `always()` still works. Every other line is copied as written.

The jobs follow this contract, which the generator enforces:

- A job id is unique across all targets and is not `plan`, `install`, `build` or `verify`.
- A job needs only jobs of its own target, and declares `permissions` as a mapping.
- A job reads the shared build through `inputs.artifact-id`, `inputs.manifest-sha256` and
  `inputs.cache-key`, never through `needs.build` or `needs.install`.
- A job that runs a bundled local action installs the build first with
  `uses: pinned:installBuiltActions`, and its egress allowlist lets the artifact download through.
- A remote action is written `uses: pinned:<key>`, a key of `PINNED`, or pinned by a 40-character
  digest with its version comment. Renovate's `github-actions` manager claims `.github/verify/`, so
  it moves a digest pin in the source and in the generated copy on one branch. Local actions are
  written `./...`.
- A source has no workflow-level `env`, `permissions`, `concurrency` or `defaults`: a job states
  what it needs, because a called workflow has nothing to inherit from the target.

## Selecting targets

The generator derives each target's inputs from [`packages/action-graph`](../packages/action-graph),
the graph the release uses:

- the actions its jobs run (`uses: ./...`, also under `tmp/actions-code` and `source`), the actions
  its end-to-end cases load, its `build` entries, and the build set of all of them
- the workspace packages, lockfiles, toolchain pins and root `tsconfig.json` those build directories
  read
- the shared build script `scripts/build-action.ts` and every file and workspace package it imports
- for a target with cases, the harness package `packages/e2e` and the files the end-to-end run reads
  first: `vitest.e2e.config.ts`, `vitest.e2e.setup.ts`, `vitest.aliases.ts` and the root `package.json`
- its source file and its `extra-inputs`

Its shard file is not an input: the shard file changes whenever any target in it changes, so it
would select every shard-mate. Instead `plan.json` records a SHA-256 of each target's rendered jobs,
pins resolved, and one of the `plan`, `install` and `build` jobs of `verify.yaml`.

`plan` intersects the inputs with the changed files from git, and compares the hashes with the plan
file of the base commit (`git show <base>:.github/verify/plan.json`), with no REST call. A target also
runs when its jobs hash changed or is new; every target that installs or builds runs when the shared
jobs hash changed:

| Event               | Changed files                        | Targets                                               |
| ------------------- | ------------------------------------ | ----------------------------------------------------- |
| `pull_request`      | merge base of base and head, to head | those whose inputs changed and whose base rule allows |
| `push`              | `before..after`; all on a new branch | on `main` and on a target's own push branch           |
| `schedule`          | not compared                         | the targets with `schedule: true`                     |
| `workflow_dispatch` | not compared                         | every target                                          |

A change to the planner (`scripts/lib/verify/affected.ts`, `plan-step.ts`, `target-inputs.ts` or
`scripts/verify-plan.ts`) selects every target. A diff git cannot compute, or a base plan git cannot
read, selects every target. Changed names are read with `git diff -z`, so a name
with a non-ASCII character or a leading space matches its inputs as committed.
`**/CHANGELOG.md` and each action's top-level `README.md` select nothing.

## Limits

| GitHub limit                  | Guard                                                    |
| ----------------------------- | -------------------------------------------------------- |
| 50 reusable workflows per run | the contract test fails above 45 shards                  |
| 500 KB per workflow file      | shards split at 300 KB of jobs; the test fails at 450 KB |
| 256 legs per matrix           | unchanged: each matrix stays inside one job              |

## Runbook

- **Add a target**: write `.github/verify/<category>-<name>.yaml`, run `bun run generate-verify`,
  commit the source and the generated files.
- **See why a target ran or did not**: the `plan` job's summary lists the changed-file count, the
  selected targets and the build directories.
- **Run everything**: dispatch `Verify` from the Actions tab.
