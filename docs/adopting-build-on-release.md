# Adopting build-on-release

Reference release workflows for another repository that wants what [release-pipeline.md](./release-pipeline.md)
describes: no `dist/` on the default branch, bundles built from the merged commit, attested, and
published on a build commit that the release tags point at.

Two shapes are covered: [a single action at the repository root](#a-single-action-at-the-repository-root)
and [a release-please monorepo](#a-release-please-monorepo). Both use the actions under
[`actions/release/`](../actions/release); their READMEs list every input.

Third-party pins are written as `<sha>` placeholders. Pin each to a full commit SHA before use; the
internal pins below are kept current by Renovate.

## Contents

- [Before you start](#before-you-start)
- [A single action at the repository root](#a-single-action-at-the-repository-root)
- [A release-please monorepo](#a-release-please-monorepo)
- [Cutting over](#cutting-over)
- [What consumers change](#what-consumers-change)

## Before you start

- **A GitHub App for releases**, installed on the repository with `contents`, `issues` and
  `pull-requests` write. An App token gets the build commit signed by GitHub, and only the App may
  create tags or move the `releases` branch.
- **An environment `release`** restricted to the default branch, holding the App's ID and private key.
  Only the publish and release-please jobs enter it.
- **Rulesets**: one on tags and one on `refs/heads/releases`, each allowing only the App to create,
  update or delete, and blocking non-fast-forward updates on the branch. This repository's are under
  [`configs/github-rulesets/`](../configs/github-rulesets).
- **A deterministic build.** Both build jobs must produce identical bytes. Pin the toolchain version
  (a `.bun-version`, `.nvmrc` or `packageManager` field) and install from a lockfile.
- **No floating major tags.** The publish job never moves a tag, so a `v1` tag that follows the latest
  `v1.x.y` cannot be maintained. Consumers pin the commit SHA with a `# vX.Y.Z` comment instead, which
  Renovate and Dependabot both update.

## A single action at the repository root

`action.yml` at the root runs `dist/index.js`, built by `npm run build`. release-please manages one
package whose component is `src`, so it tags `src-vX.Y.Z` on the default branch and consumers pin
`vX.Y.Z` on the build commit.

`release-please-config.json`:

```json
{
  "skip-github-release": true,
  "packages": {
    ".": { "release-type": "node", "component": "src", "include-component-in-tag": true }
  }
}
```

`.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  queue: max

permissions: {}

jobs:
  plan:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: read
      pull-requests: read
    outputs:
      is-release: ${{ steps.plan.outputs.is-release }}
      pending: ${{ steps.pending.outputs.pending }}
    steps:
      - id: plan
        uses: TimSchoenle/actions/actions/release/plan-release-please@49acdef9979f343817ec2a85ddd25e5f34befc8b # tag=actions-release-plan-release-please-v1.1.1
        with:
          mode: plan
          sha: ${{ github.sha }}
          release-pr-author-id: '<your release App bot user ID>'
      # Skips release-please while a merged release pull request is still pending.
      - id: pending
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          count="$(gh api --method GET "repos/${GITHUB_REPOSITORY}/issues" -f labels='autorelease: pending' -f state=closed \
            --paginate --jq '.[] | select(.pull_request.merged_at != null) | .number' | wc -l)"
          echo "pending=$([ "$count" -gt 0 ] && echo true || echo false)" >> "$GITHUB_OUTPUT"

  # build and build-verify are identical but for the artifact name.
  build:
    needs: plan
    if: needs.plan.outputs.is-release == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      artifact-id: ${{ steps.build.outputs.artifact-id }}
      artifact-digest: ${{ steps.build.outputs.artifact-digest }}
      manifest-sha256: ${{ steps.build.outputs.manifest-sha256 }}
    steps:
      - uses: actions/checkout@<sha> # v7
        with:
          persist-credentials: false
          ref: ${{ github.sha }}
      - uses: actions/setup-node@<sha> # v7
        with:
          node-version-file: '.nvmrc'
      - run: npm ci --ignore-scripts
      - id: build
        uses: TimSchoenle/actions/actions/release/build-actions@49acdef9979f343817ec2a85ddd25e5f34befc8b # tag=actions-release-build-actions-v1.1.1
        with:
          build-dirs: .
          build-command: npm run build
          artifact-name: release-bundles-${{ github.run_attempt }}
          source-sha: ${{ github.sha }}

  build-verify:
    needs: plan
    if: needs.plan.outputs.is-release == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      manifest-sha256: ${{ steps.build.outputs.manifest-sha256 }}
    steps:
      - uses: actions/checkout@<sha> # v7
        with:
          persist-credentials: false
          ref: ${{ github.sha }}
      - uses: actions/setup-node@<sha> # v7
        with:
          node-version-file: '.nvmrc'
      - run: npm ci --ignore-scripts
      - id: build
        uses: TimSchoenle/actions/actions/release/build-actions@49acdef9979f343817ec2a85ddd25e5f34befc8b # tag=actions-release-build-actions-v1.1.1
        with:
          build-dirs: .
          build-command: npm run build
          artifact-name: release-bundles-verify-${{ github.run_attempt }}
          source-sha: ${{ github.sha }}

  attest:
    needs: [plan, build, build-verify]
    if: needs.plan.outputs.is-release == 'true'
    runs-on: ubuntu-latest
    permissions:
      actions: read
      attestations: write
      contents: read
      id-token: write
    steps:
      - if: needs.build.outputs.manifest-sha256 != needs.build-verify.outputs.manifest-sha256
        run: |
          set -euo pipefail
          echo "::error::The two builds produced different bundles."
          exit 1
      - uses: TimSchoenle/actions/actions/release/install-built-actions@49acdef9979f343817ec2a85ddd25e5f34befc8b # tag=actions-release-install-built-actions-v1.1.1
        with:
          artifact-id: ${{ needs.build.outputs.artifact-id }}
          expected-manifest-sha256: ${{ needs.build.outputs.manifest-sha256 }}
          expected-artifact-digest: ${{ needs.build.outputs.artifact-digest }}
          github-token: ${{ github.token }}
      - uses: actions/download-artifact@<sha> # v8
        with:
          artifact-ids: ${{ needs.build.outputs.artifact-id }}
          path: ${{ runner.temp }}/attest
          digest-mismatch: error
      - uses: actions/attest-build-provenance@<sha> # v4
        with:
          subject-checksums: ${{ runner.temp }}/attest/bundles.sha256

  publish:
    needs: [plan, build, build-verify, attest]
    if: needs.plan.outputs.is-release == 'true'
    runs-on: ubuntu-latest
    environment: release
    permissions:
      actions: read
      contents: read
      pull-requests: read
    steps:
      - id: token
        uses: actions/create-github-app-token@<sha> # v3
        with:
          client-id: ${{ secrets.RELEASE_APP_ID }}
          private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}
          permission-contents: write
          permission-issues: write
          permission-pull-requests: write
      - id: plan
        uses: TimSchoenle/actions/actions/release/plan-release-please@49acdef9979f343817ec2a85ddd25e5f34befc8b # tag=actions-release-plan-release-please-v1.1.1
        with:
          mode: plan
          sha: ${{ github.sha }}
          release-pr-author-id: '<your release App bot user ID>'
      - uses: TimSchoenle/actions/actions/release/publish-build-commit@7c1147cf1e275c068a8484fa9a2dcb38a8b1f92f # tag=actions-release-publish-build-commit-v1.1.0
        with:
          token: ${{ steps.token.outputs.token }}
          source-sha: ${{ github.sha }}
          artifact-id: ${{ needs.build.outputs.artifact-id }}
          expected-artifact-digest: ${{ needs.build.outputs.artifact-digest }}
          expected-manifest-sha256: ${{ needs.build.outputs.manifest-sha256 }}
          cross-check-manifest-sha256: ${{ needs.build-verify.outputs.manifest-sha256 }}
          allowed-paths: dist/**
          releases: ${{ steps.plan.outputs.releases }}
          release-assets: bundles
          pull-request: ${{ steps.plan.outputs.pull-request }}

  preflight:
    needs: [plan, publish]
    if: >-
      !cancelled() && needs.plan.result == 'success' &&
      ((needs.plan.outputs.is-release == 'true' && needs.publish.result == 'success') ||
      (needs.plan.outputs.is-release != 'true' && needs.plan.outputs.pending != 'true'))
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: TimSchoenle/actions/actions/release/plan-release-please@49acdef9979f343817ec2a85ddd25e5f34befc8b # tag=actions-release-plan-release-please-v1.1.1
        with:
          mode: preflight

  release-please:
    needs: preflight
    if: ${{ !cancelled() && needs.preflight.result == 'success' }}
    runs-on: ubuntu-latest
    environment: release
    permissions: {}
    steps:
      - id: token
        uses: actions/create-github-app-token@<sha> # v3
        with:
          client-id: ${{ secrets.RELEASE_APP_ID }}
          private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}
          permission-contents: write
          permission-issues: write
          permission-pull-requests: write
      - uses: googleapis/release-please-action@<sha> # v5
        with:
          token: ${{ steps.token.outputs.token }}
          skip-github-release: true
```

Add `step-security/harden-runner` with `egress-policy: block` as the first step of each job; the
**Egress** section of each action's README lists the endpoints it needs, and the table in
[release-pipeline.md](./release-pipeline.md#jobs) those of the other steps.

## A release-please monorepo

Every package gets the component `src-<consumer component>`: `actions/foo` with consumer tags
`actions-foo-vX.Y.Z` gets `"component": "src-actions-foo"`. The workflow is the one above with these
differences, all of which this repository's own
[`release.yml`](../.github/workflows/release.yml) shows in place:

- The build jobs resolve every action instead of naming one:

  ```yaml
  - id: resolve
    uses: TimSchoenle/actions/actions/release/resolve-actions@49acdef9979f343817ec2a85ddd25e5f34befc8b # tag=actions-release-resolve-actions-v1.1.1
  - id: build
    uses: TimSchoenle/actions/actions/release/build-actions@49acdef9979f343817ec2a85ddd25e5f34befc8b # tag=actions-release-build-actions-v1.1.1
    with:
      build-dirs: ${{ steps.resolve.outputs.build-dirs }}
      build-command: npm run build
      artifact-name: release-bundles-${{ github.run_attempt }}
      source-sha: ${{ github.sha }}
  ```

  `build-command` runs once in each build directory. Pass `exclude` for template directories that hold
  an `action.yml` that is not a real action.

- `allowed-paths` keeps its default, `actions/*/**/dist/**/*`, or names wherever the bundles live.
- `consumer-tag-pattern` on every `plan-release-please` step narrows the accepted consumer tags, such
  as `'^actions-[a-z0-9-]+-v\d+\.\d+\.\d+$'`.
- `release-assets: bundles` attaches to each Release only the bundles below that package's path.
- A package added later has no tag at all, and preflight fails until it gets a source tag. This
  repository creates it automatically with the `source-tags-plan` and `source-tags` jobs of
  [`release.yml`](../.github/workflows/release.yml), on the parent of the commit that added the
  package. Copy those jobs and their script, or create the tag by hand. Keep the job that creates the
  tags in the same workflow as the rest: a job of a called workflow read the release environment's
  secrets as empty.

## Cutting over

1. Stop committing `dist/`: add it to `.gitignore`, `git rm -r --cached` it, and replace any CI check
   that compared committed bundles with a build-only step.
2. Make the build jobs of every workflow that runs the action from a checkout build first; the
   [`release/install-built-actions`](../actions/release/install-built-actions) README shows the
   build and install jobs.
3. Create the source tag of every package's current version on the commit its existing tag points
   at, with the App token:

   ```bash
   gh api --method POST "repos/${REPO}/git/refs" -f "ref=refs/tags/src-${TAG}" -f "sha=$(git rev-parse "${TAG}^{commit}")"
   ```

4. Merge the config change (`src-` components, `skip-github-release`) together with the workflow, while
   no merged release pull request is labelled `autorelease: pending`.
5. Check the first release: `B` on `releases`, consumer tags on `B`, source tags on `M`, the Releases
   with their assets, the pull request labelled `autorelease: tagged`, and the next release pull
   request listing only new commits.

Existing tags stay where they are. They point at default-branch commits that still carry their bundles,
so existing pins keep working.

## What consumers change

Nothing. A pin of `owner/repo@<sha> # vX.Y.Z` resolves the same way whether the SHA is a commit on the
default branch or on `releases`, and Renovate's `github-tags` lookup returns the commit the new tag
points at.
