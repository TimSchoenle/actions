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

| Job                 | Runs when                         | Does                                                                                       |
| ------------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| `plan`              | always                            | diffs with git, selects the affected targets, the shards to call and the build list        |
| `install`           | a target is selected              | installs the workspace once and saves the dependency cache; the only job with the registry |
| `build`             | a selected target runs a bundle   | builds the union of the selected targets' build directories with `release/build-actions`   |
| `verify-<category>` | the shard holds a selected target | calls the shard; each of its jobs runs only when its target is selected                    |
| `verify`            | always                            | fails when any job above failed or was cancelled                                           |

The `verify` job, named `CI Summary: Verify` while CI Required still aggregates the remaining
hand-written workflows, is the check branch protection requires. The pull request's own copy of the
workflow decides it, as it does for `Lint & Test`.

A shard receives `targets`, `cache-key`, `artifact-id` and `manifest-sha256` as inputs, and only the
secrets its jobs read. Its caller job grants the union of its jobs' permissions: a called workflow
can narrow its token, never widen it.

## Source format

```yaml
target: common/find-patch # <category>/<name>; the file is common-find-patch.yaml
title: Common Find-patch # optional; derived from the target
e2e: # present when actions/<target>/e2e/ has cases
  token-permissions: { metadata: read } # always explicit
  secondary-token-permissions: {} # optional: a second App identity
  extra-endpoints: [] # optional: hosts beyond api.github.com; never a registry
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
`bun run e2e actions/<target>` with a token scoped to the scratch repository.

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
- A pinned action is written `uses: pinned:<key>`, a key of `PINNED`; local actions as `./...`.

## Selecting targets

The generator derives each target's inputs from [`packages/action-graph`](../packages/action-graph),
the graph the release uses:

- the actions its jobs run (`uses: ./...`, also under `tmp/actions-code` and `source`), the actions
  its end-to-end cases load, its `build` entries, and the build set of all of them
- the workspace packages, lockfiles and toolchain pins those build directories read
- the harness package `packages/e2e`, for a target with cases, and the shared build script
- its source file, its shard file and its `extra-inputs`

`plan` intersects those with the changed files from git, with no REST call:

| Event               | Changed files                        | Targets                                               |
| ------------------- | ------------------------------------ | ----------------------------------------------------- |
| `pull_request`      | merge base of base and head, to head | those whose inputs changed and whose base rule allows |
| `push`              | `before..after`; all on a new branch | on `main` and on a target's own push branch           |
| `schedule`          | not compared                         | the targets with `schedule: true`                     |
| `workflow_dispatch` | not compared                         | every target                                          |

A change to `verify.yaml` selects every target. A diff git cannot compute selects every target.
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
