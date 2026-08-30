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

## Required status checks

The default-branch ruleset marks a handful of contexts required. Two properties decide whether a
context is safe to require, and neither is visible in the workflow that produces it:

- **It must report on every pull request.** GitHub has no "not applicable" state, so a context that
  is sometimes absent leaves the pull request on _Expected — waiting for status to be reported_
  forever. A path-filtered workflow can never supply one. Neither can a reusable-workflow call: its
  checks are named `<caller job> / <called job>` while the call runs, and only `<caller job>` while
  it is skipped, so neither name is always there. A plain job is safe — a skipped one still reports,
  and branch protection accepts it.
- **It must report after the work it gates.** `ci-required` aggregates the path-filtered
  `verify-action-*` workflows, and it does so from a `workflow_run` trigger, whose check runs land on
  the default branch rather than on the pull request head. Only the commit status it POSTs reaches
  the pull request, so `ci-required` is the context to require — never the `Aggregate verify checks`
  job name, which on a pull request evaluates before any verify workflow has started and passes with
  zero matches.

[`scripts/lib/required-checks.ts`](scripts/lib/required-checks.ts) lists the required contexts and
the reason for each. Its contract test proves every listed context is produced unconditionally by the
workflow that owns it, and names the contexts that must never be required. GitHub remains the source
of truth for enforcement; reconcile the two after changing either:

```bash
bun run check-required-checks            # report drift
bun run check-required-checks -- --apply # rewrite the ruleset to match the manifest
```

Both read the ruleset, so they need a `gh` login with `repo` scope and are not part of CI. Apply only
once every listed context is already produced on `main`: a context required before the workflow that
produces it has landed blocks every open pull request instead of gating it.

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

Both are the short form of [docs/readme/PROSE.md](docs/readme/PROSE.md), which is the full contract
and covers every README, template, `docs/` page, commit body and pull request description here.

Doc comments have their own contract in [docs/doc-comments/](docs/doc-comments/README.md). It says
what carries a comment, what that comment has to state before it states anything else, and which lint
gate holds it in place per ecosystem.
