# Contributing

## Prerequisites

[Bun](https://bun.sh) at the version in [.bun-version](.bun-version). CI pins that file rather than
taking the latest release: the bundle check rebuilds every action and compares the result against the
committed bytes, and Bun's minifier renames identifiers between releases, so a different Bun fails
the check without any source having changed.

```bash
bun install --frozen-lockfile
```

## Adding and removing components

Four interactive generators own the scaffolding. `create-action` writes the directory and its
`action.yaml`, the `verify-action-*` workflow, the `ci-required` entry that watches it, the
release-please package and manifest entries, and then regenerates the docs. It does all of that in
one run because those five have to agree.

```bash
bun run create-action     # actions/<category>/<name>/, action.yaml, verify workflow
bun run remove-action     # the same set, deleted together
bun run create-workflow   # workflows/<category>/<name>/, workflow.yaml, README, configs
bun run remove-workflow
```

Adding a directory by hand leaves it out of `.release-please-manifest.json`, and an unversioned
component is skipped by the docs generator and never released.

## Generated files

Several files in this repository are outputs. Editing one is reverted on the next pull request,
because CI regenerates it and commits the result back to the branch.

| Output                                   | Generated from                                                                       | Command                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------- |
| `README.md`, `SECURITY.md`               | `scripts/templates/`, plus every `action.yaml`, `workflow.yaml` and `configs/*.json` | `bun run generate-docs`           |
| `actions/*/*/dist/`                      | each action's `src/`                                                                 | `bun run build:workspaces`        |
| `actions/*/*/src/generated/action-io.ts` | that action's `action.yaml`                                                          | `bun run generate-action-sources` |
| `.github/workflows/verify-action-*.yaml` | `scripts/lib/e2e-workflow.ts`                                                        | `bun run generate-e2e-workflows`  |
| `.github/workflows/ci-required.yaml`     | the workflow files themselves                                                        | `bun run generate-ci-required`    |

The pre-commit hook regenerates `action-io.ts` and checks the bundles for the staged files only. The
rest are checked in CI and committed back to the branch when they drift.

## Before opening a pull request

```bash
bun run format
bun run lint
bun run typecheck
bun run test
```

Scripts CI runs those, plus `check-action-sources`, `check-action-dist` and `check-e2e-workflows`,
each of which fails when a committed output no longer matches its source. `zizmor` and `actionlint`
read the workflow files in the Security workflow; CodeQL analyses the TypeScript in its own.

## Commits

Conventional Commits, because release-please reads them. The type decides the version bump for the
component whose directory the commit touches: `fix` a patch, `feat` a minor, a `!` or a
`BREAKING CHANGE` footer a major. Anything else releases nothing.

Scope the commit to one component where you can. A commit spanning two directories bumps both.

Commits must be signed. The default-branch ruleset rejects unsigned ones, and the release bot is the
only identity permitted to create a release tag.

## Prose

Two rules cover most of what gets sent back in review. Name the mechanism rather than its shape: an
action resolves a tag to the commit SHA it points at, it does not handle versioning. And delete any
sentence that would be equally true of a different repository.
