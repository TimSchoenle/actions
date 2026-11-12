# Contributing

## Prerequisites

[Bun](https://bun.sh) at the version in [.bun-version](.bun-version). CI and the release pin that file
rather than taking the latest release: the release builds every bundle twice and publishes only when
both builds are byte-for-byte identical, and Bun's minifier renames identifiers between releases.

```bash
bun install --frozen-lockfile
```

## Adding and removing components

Two interactive generators own the scaffolding. `create-action` writes the directory and its
`action.yaml`, its verify source under `.github/verify/` and the Verify workflows generated from it,
the release-please package and manifest entries, and then regenerates the docs. It does all of that
in one run because those five have to agree.

```bash
bun run create-action     # actions/<category>/<name>/, action.yaml, verify source
bun run remove-action     # the same set, deleted together
```

Adding a directory by hand leaves it out of `.release-please-manifest.json`, and an unversioned
component is skipped by the docs generator and never released. A new package needs no tag of its own:
the release workflow creates its source tag on the first push to `main` after it lands (see
[docs/release-pipeline.md](docs/release-pipeline.md#adding-a-package)).

## Generated files

Several files in this repository are outputs. Editing one is reverted on the next pull request,
because CI regenerates it and commits the result back to the branch.

| Output                                                       | Generated from                                                      | Command                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------- |
| `README.md`, `SECURITY.md`                                   | `scripts/templates/`, plus every `action.yaml` and `configs/*.json` | `bun run generate-docs`           |
| `actions/*/*/src/generated/action-io.ts`                     | that action's `action.yaml`                                         | `bun run generate-action-sources` |
| `.github/workflows/verify*.yaml`, `.github/verify/plan.json` | `.github/verify/*.yaml`, `scripts/lib/verify/`                      | `bun run generate-verify`         |

The pre-commit hook regenerates `action-io.ts` for the staged `action.yaml` files, and Scripts CI fails
a pull request whose committed copies have drifted. The rest are checked in CI and committed back to
the branch when they drift.

## Action bundles

`dist/` is not committed. GitHub runs an action's `runs.main` bundle, so the release builds every
bundle from the merged commit and publishes it on a build commit that the release tags point at; see
[docs/release-pipeline.md](docs/release-pipeline.md). To run an action from a checkout, build it
first:

```bash
bun run build:actions --all                        # every action
bun run build:actions actions/common/create-patch  # one action, with the actions it needs
```

The Verify workflow builds the bundles its selected targets run once, in its `build` job, and every
job installs them before any step uses them (see [docs/verify-pipeline.md](docs/verify-pipeline.md)); the end-to-end harness refuses a bundle that build did not produce.

## Dependencies of a Node action

Every Node action ships its bundle in every release, so each dependency is paid for in each one. The shared
library `actions-util` (`packages/ts-util`) provides what the GitHub Actions toolkit would:

| Instead of             | Use                                                                   |
| ---------------------- | --------------------------------------------------------------------- |
| `@actions/core`        | `actions-util/core` (same names and output)                           |
| `@actions/github`      | `createOctokit` from `actions-util/client`                            |
| `@actions/http-client` | `httpRequest` from `actions-util`, or `actions-util/release-download` |

The toolkit packages bundle undici, over 400 KB per action, and ESLint refuses their imports. Both
replacements honour `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` as the toolkit did. `octokit.rest`
exposes the endpoints listed in `REST_ROUTES` (`packages/ts-util/src/octokit.ts`); add a route there
to call another one. YAML helpers live behind `actions-util/yaml`, so actions that never parse YAML
do not bundle the parser.

## Before opening a pull request

```bash
bun run format
bun run lint
bun run typecheck
bun run test
```

Scripts CI runs those, plus `check-action-sources` and `check-verify`, each of which fails when
a committed output no longer matches its source, and `build:actions --all`, which fails when any
bundle no longer builds. `jactionlint` checks the
workflow files and composite actions in the Security workflow, with the settings in
`.github/jactionlint.yaml`; CodeQL analyses the TypeScript in its own.

## Renovate presets

Every repository that extends `configs/renovate/*` runs these presets, so a broken one fails there,
as a warning on each consumer's Dependency Dashboard. The `Verify Config Renovate` workflow checks a
change before it lands, with the Renovate release pinned in
[`.github/tools/renovate`](.github/tools/renovate/package.json):

```bash
bun install --frozen-lockfile --cwd .github/tools/renovate
bun run check-renovate-configs                       # renovate-config-validator --strict
GITHUB_COM_TOKEN=$(gh auth token) bun run check-renovate-lookups   # dry-run the fixtures
```

`check-renovate-lookups` runs Renovate against each fixture repository in
[`scripts/__fixtures__/renovate/`](scripts/__fixtures__/renovate), with the presets loaded from the
working tree rather than from `main`, and asserts the updates listed in the fixture's `case.json`:
which dependency, how many updates at least, the pattern every new value matches and the branch it
lands on. Any lookup warning or repository problem fails the fixture. A preset change that fixes or
adds behaviour comes with a fixture that fails without it. Fixtures pin old releases on purpose, so
they always have an update to propose; pass fixture names to run only those.

## Required status checks

The default-branch ruleset marks a handful of contexts required. Two properties decide whether a
context is safe to require, and neither is visible in the workflow that produces it:

- **It must report on every pull request.** GitHub has no "not applicable" state, so a context that
  is sometimes absent leaves the pull request on _Expected — waiting for status to be reported_
  forever. A path-filtered workflow can never supply one. Neither can a reusable-workflow call: its
  checks are named `<caller job> / <called job>` while the call runs, and only `<caller job>` while
  it is skipped, so neither name is always there. A plain job is safe — a skipped one still reports,
  and branch protection accepts it.
- **It must report after the work it gates.** A job that runs alongside the work, rather than after it,
  reports before the work has failed.

`Verify`, the final job of the generated [`verify.yaml`](.github/workflows/verify.yaml), meets both.
The workflow runs on every pull request without a path filter; its `plan` job selects the targets
the change affects, and the `Verify` job needs `plan`, `install`, `build` and every shard call and
fails when any of them failed or was cancelled. It reports whether the change selects every target
or none. Require `Verify`, never a shard call or a job inside a shard: those report under nested
names, or not at all when their target is not selected. Like `Lint & Test`, the pull request's own
copy of the workflow decides the verdict, so review covers a change to it. See
[docs/verify-pipeline.md](docs/verify-pipeline.md).

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
only identity permitted to create a release tag or move the `releases` branch.

Choose the type by what consumers get. A pull request that changes only workflows, tooling or
generated files under component directories takes a type that releases nothing (`ci`, `chore`,
`docs`, `test`); any other type releases every component whose directory it touches.

## Prose

Two rules cover most of what gets sent back in review. Name the mechanism rather than its shape: an
action resolves a tag to the commit SHA it points at, it does not handle versioning. And delete any
sentence that would be equally true of a different repository.

Both are the short form of [docs/readme/PROSE.md](docs/readme/PROSE.md), which is the full contract
and covers every README, template, `docs/` page, commit body and pull request description here.

Doc comments have their own contract in [docs/doc-comments/](docs/doc-comments/README.md). It says
what carries a comment, what that comment has to state before it states anything else, and which lint
gate holds it in place per ecosystem.
