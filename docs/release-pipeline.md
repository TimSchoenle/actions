# Release pipeline

How this repository releases its actions: bundles are built when a release pull request merges and
published on a build commit, so `main` and pull requests carry no `dist/`. The workflow is
[`.github/workflows/release.yml`](../.github/workflows/release.yml); the actions it runs are under
[`actions/release/`](../actions/release).

## Contents

- [Refs](#refs)
- [Why release-please has its own tags](#why-release-please-has-its-own-tags)
- [Jobs](#jobs)
- [What a published release guarantees](#what-a-published-release-guarantees)
- [Runbook](#runbook)
- [Repository settings](#repository-settings)
- [Rollback](#rollback)

## Refs

| Ref                                  | Points at                                                                                | Created by                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| `main`                               | sources only                                                                             | pull requests                             |
| merge commit `M`                     | the squash commit of a release pull request on `main`                                    | release-please's pull request, merged     |
| build commit `B`                     | tree of `M` plus every bundle, nothing removed or changed; parents: `releases` head, `M` | publish job, through the Git Data API     |
| `releases` branch                    | the latest `B`; every `B` is chained on the one before, moved by fast-forward only       | publish job                               |
| `actions-<path>-vX.Y.Z` (consumer)   | `B`. What consumers pin, what the READMEs pin and what Renovate updates                  | publish job                               |
| `src-actions-<path>-vX.Y.Z` (source) | `M`. What release-please finds the previous release by                                   | publish job; source-tags job for the rest |

Tags created before this pipeline point at commits on `main` that carry their bundles, and have no
`src-` tag of their own until the source-tags job creates one on the same commit. No existing tag
moved.

## Why release-please has its own tags

release-please finds a package's previous release through the commit its tag points at, then walks
`main` back until it reaches that commit, collecting the commits in between as unreleased. A consumer
tag on `B` is never reached, because `B` is not on `main`. release-please would then collect up to 500
commits for every component: wrong changelogs and spurious version bumps.

So every component in [`release-please-config.json`](../release-please-config.json) carries the `src-`
prefix (`src-actions-common-read-yaml`), and release-please reads the source tags on `main`. The
consumer tags belong to no configured component, and release-please ignores them. A
release-please-readable tag must therefore always point at a commit on `main`.

`skip-github-release: true` stops release-please creating tags and Releases. The merged release pull
request stays labelled `autorelease: pending` until the publish job relabels it `autorelease: tagged`,
and while any merged pull request is pending, release-please opens no new release pull request. A
publish that failed part-way can therefore not be overtaken by the next release.

## Jobs

On the merge commit `M` of a release pull request:

```text
plan ─┬─ build ────────┬─ attest ── publish ─┬─ generate-docs ── commit-docs
      └─ build-verify ─┘                     └─ source-tags ── preflight ── release-please
```

On every other push to `main`: `plan`, then `source-tags`, `preflight` and `release-please`. Runs of
the workflow queue behind each other and are never cancelled.

| Job                     | Token                                                           | Secrets                                | Runs repository code | Egress (harden-runner `block`)                                                                       |
| ----------------------- | --------------------------------------------------------------- | -------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| `plan`                  | `contents`, `issues`, `pull-requests`: read                     | none                                   | no                   | api.github.com                                                                                       |
| `build`, `build-verify` | `contents: read`                                                | none                                   | yes, `M`             | github.com, objects/release-assets.githubusercontent.com, registry.npmjs.org, artifact storage       |
| `attest`                | `id-token`, `attestations`: write; `actions`, `contents`: read  | none                                   | no                   | fulcio.sigstore.dev, rekor.sigstore.dev, tuf-repo-cdn.sigstore.dev, api.github.com, artifact storage |
| `publish`               | `actions`, `contents`, `pull-requests`: read; release App token | release App key, environment `release` | no                   | api.github.com, uploads.github.com, artifact storage                                                 |
| `source-tags`           | plan: `contents: read`; apply: release App token                | apply: release App key, `release`      | plan only            | plan: github.com; apply: api.github.com                                                              |
| `preflight`             | `contents: read`                                                | none                                   | no                   | api.github.com                                                                                       |
| `release-please`        | none; release App token                                         | release App key, `release`             | no                   | api.github.com                                                                                       |
| `generate-docs`         | `contents: read`                                                | none                                   | yes                  | audit                                                                                                |
| `commit-docs`           | `contents: read`; release App token                             | release App key, `release`             | no                   | as before                                                                                            |

- **plan** runs [`release/plan-release-please`](../actions/release/plan-release-please) in `plan` mode.
  It reports a release only when the commit is the merge commit of a merged pull request from the
  release App (user `248313786`) that is still labelled `autorelease: pending` and changes the manifest.
  It also reports whether any merged release pull request is pending.
- **build** and **build-verify** check out `M`, install with a frozen lockfile and no lifecycle
  scripts, resolve every action with [`release/resolve-actions`](../actions/release/resolve-actions),
  and build them with [`release/build-actions`](../actions/release/build-actions). Each uploads one
  artifact with a manifest listing every bundle's SHA-256.
- **attest** fails when the two manifests differ, verifies the build job's artifact against its
  manifest hash and archive digest with [`release/install-built-actions`](../actions/release/install-built-actions),
  and signs SLSA build provenance for every bundle with `actions/attest-build-provenance`.
- **publish** plans again (so its notes files exist in its job) and runs
  [`release/publish-build-commit`](../actions/release/publish-build-commit), which creates `B`, moves
  `releases`, creates the consumer and source tags, publishes one Release per consumer tag with
  `bundles.sha256` and the bundles as assets, and relabels the pull request last. Every step is an
  ensure: a re-run finishes what a failed run started and changes nothing that is already in place.
  `existing-files: fail` refuses a bundle path that exists in `M`, so `B` only adds files.
- **source-tags** calls [`bootstrap-source-tags.yml`](../.github/workflows/bootstrap-source-tags.yml):
  [`scripts/bootstrap-source-tags.ts`](../scripts/bootstrap-source-tags.ts) plans the missing source
  tags, and the apply job creates them after checking each name and that each commit is on `main`. It
  is skipped while a release is in flight, except in the run that published it.
- **preflight** runs `plan-release-please` in `preflight` mode and fails while any package lacks the
  source tag of its manifest version. **release-please** runs only after it passed.
- **generate-docs** and **commit-docs** regenerate the READMEs once the consumer tags exist, so every
  pin resolves to `B`, and commit the result to `main`.

Artifacts are always selected by the ID the build job output, never by name, and every action in a
job that holds a secret or `id-token: write` is pinned by commit.

## What a published release guarantees

- `B`'s tree is `M`'s tree plus files under `actions/**/dist/`, computed locally and checked against
  the tree GitHub created. Nothing at `M` is removed or changed.
- Every bundle in `B` was built twice from `M` on separate runners with byte-identical results, and
  the published bytes match the manifest the build job reported.
- Every bundle has a provenance attestation signed by `release.yml` on `refs/heads/main`.
- No tag was moved. `releases` only moved forward.

[SECURITY.md](../SECURITY.md#verifying-a-release) shows how a consumer checks each of these.

## Runbook

### A release

Nothing to do. Merging the release pull request (by hand, or by `auto-merge-release-please.yml`)
publishes it. The run on `M` then opens the next release pull request if commits are waiting.

### Publish failed

The run on `M` is red and the pull request is still labelled `autorelease: pending`, so no new release
pull request opens until this is resolved.

1. Read the failed job's log. Nothing is published before the bundles are verified, and every publish
   step can be repeated.
2. Within seven days, while the build artifacts are kept, **Re-run failed jobs** on that run.
3. Past seven days and within the 30 days GitHub allows re-runs, **Re-run all jobs** on that run: it
   rebuilds from `M` with the workflow as it was at `M`.
4. When the fix needs a workflow or source change, the run on `M` cannot pick it up: the workflow
   builds only the commit that triggered it and takes no input naming another, so its jobs only ever
   run code from that push. `M`'s versions are then skipped (see [Skipping a release](#skipping-a-release)).

Once publish succeeds, the next push to `main` runs release-please again.

### The two builds disagree

`attest` fails with both manifest hashes, and nothing is attested or published. The build is not
deterministic for some input. Download both artifacts from the run, compare the bundles and fix the
cause in a pull request. A re-run of `M` would build the same inputs again, so `M`'s versions are
skipped (see below) and the fix ships with the next release.

### Skipping a release

Only once it is decided that `M` will never be published. An admin, under a temporary bypass of the
tag ruleset, creates `src-<component>-vX.Y.Z` on `M` for every version the pull request released, then
labels the pull request `autorelease: tagged`. No consumer tag or Release exists for those versions,
so no consumer can pin them, and release-please proposes the next versions from `M`. The bootstrap
cannot create these tags itself: with no consumer tag it reports them as unresolved, by design.

### Preflight failed

Its log lists the missing source tags. Dispatch **Bootstrap Source Tags** with `dry-run` checked to see
why each is missing:

- _a release of it is in flight or failed part-way_: finish that release (see above).
- _points at a build commit, but its source tag is missing_: re-run that release's publish job, which
  creates both.
- _not in the default branch's history_: a source tag was created in the wrong place. The pipeline
  never moves a tag, and the tag ruleset lets only the release App delete one, so an admin deletes it
  under a temporary bypass and the next push recreates it.

### Adding a package

`bun run create-action` registers the package at `1.0.0` with the component `src-actions-<path>`. The
first push to `main` after it merges creates `src-actions-<path>-v1.0.0` on the parent of the commit
that added the package, so release-please sees that commit as unreleased and proposes `1.1.0` (or
`2.0.0` for a breaking change).

### Removing a package

`bun run remove-action` deletes its config and manifest entries. Its tags and Releases stay, so
existing pins keep working.

## Repository settings

These are not in code. An admin applies them; the rulesets are exported under
[`configs/github-rulesets/`](../configs/github-rulesets).

| Setting                                                                                                                                                                     | When                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Environment `release`: deployment branches `main` only, holding `RELEASE_BOT_APP_ID` and `RELEASE_BOT_PRIVATE_KEY`                                                          | before the first release               |
| Ruleset [`branch-releases_only-allow-release-bot.json`](../configs/github-rulesets/branch-releases_only-allow-release-bot.json)                                             | before the first release               |
| Default-branch ruleset without the `Build Actions and Commit` context ([`branch-default_default-rules.json`](../configs/github-rulesets/branch-default_default-rules.json)) | when this pipeline merges              |
| Immutable releases (Settings, General, Releases)                                                                                                                            | after the first release published here |

The release App also needs `contents`, `issues` and `pull-requests` write on the repository, which it
already has for release-please. Immutable releases lock a published Release's tag and assets. The
publish job uploads every asset to a draft and publishes it last, which immutable releases allow;
confirm that on the first release after enabling them.

## Rollback

| What                   | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The whole pipeline     | Revert the pull request that introduced it, and in the same pull request set `last-release-sha` in `release-please-config.json` to the latest released `M`: otherwise release-please, reading unprefixed components again, finds the consumer Releases on `B` and walks the whole history. Rebuild the bundles with `bun run build:actions --all` and commit them, since sources may have changed after the revert point. Remove `last-release-sha` after the next release. Restore the `Build Actions and Commit` context in the default-branch ruleset. |
| Source tags            | Leave them. release-please without the `src-` components does not read them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Build commits and tags | Leave them. Consumers pin them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
