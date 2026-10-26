<!--
Generated from scripts/templates/README.md by `bun run generate-docs`. Edit the template, not this
file.

Every row below is read out of the repository itself. Each `action.yaml`, `workflow.yaml` and
`configs/*.json` supplies its own name and description, `.release-please-manifest.json` supplies the
released version, and every tag is resolved to the commit it points at, so the `uses:` lines are SHA
pins rather than moving references.

The update-readme job in .github/workflows/update-files.yml runs the same command on every pull
request and commits the result back to the branch. An edit made here is overwritten, not merged.
-->

# Actions

Composite and Node GitHub Actions, reusable workflows and shared Renovate presets, each released
under its own tag.

[![CI](https://img.shields.io/github/actions/workflow/status/TimSchoenle/actions/scripts-ci.yml?branch=main&label=ci)](https://github.com/TimSchoenle/actions/actions/workflows/scripts-ci.yml)
[![License](https://img.shields.io/github/license/TimSchoenle/actions)](LICENSE)

## What this is

One repository holding the CI parts the other repositories in this account call: the actions under
`actions/`, the callable workflows under `workflows/`, and the Renovate presets and branch rulesets
under `configs/`.

Each directory is its own release-please component, so `actions/rust/clippy` and
`actions/bun/setup-cached` are versioned and tagged apart from each other. A tag names the component
it belongs to, as `actions-<path>-vX.Y.Z` or `workflows-<path>-vX.Y.Z`. The tables below carry the
current tag of every component and the `uses:` line that pins it.

## Quick start

Copy a `uses:` line from the tables below. It pins the released tag to the commit that tag points
at, and repeats the tag in a trailing comment.

Then extend the shared Renovate preset in your `renovate.json`:

```json
{
  "extends": ["github>TimSchoenle/actions//configs/renovate/base"]
}
```

The preset installs a regex manager that matches exactly that shape. It also turns Renovate's
built-in github-actions manager off for this repository, so a pin written without its `# tag=`
comment matches nothing and never moves. The versioning regex carries the component prefix through
as its `compatibility` group. That is what stops a release of `actions-rust-clippy` being offered as
an upgrade to `actions-bun-setup-cached`.

## Table of contents

- [Usage](#usage)
  - [Actions](#actions)
  - [Reusable workflows](#reusable-workflows)
  - [Shared configurations](#shared-configurations)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Usage

### Actions

The first column links to the action's directory. Its `action.yaml` declares the inputs and the
outputs. Where an action needs more than that, a README sits next to it.

#### Bun

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Bun Setup-cached](./actions/bun/setup-cached) | Sets up a pinned Bun and installs dependencies from the lockfile, with a node_modules cache that by default only trusted events write to. | [actions-bun-setup-cached-v2.0.0](https://github.com/TimSchoenle/actions/releases/tag/actions-bun-setup-cached-v2.0.0) | `uses: TimSchoenle/actions/actions/bun/setup-cached@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-bun-setup-cached-v2.0.0` |

#### Common

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Close Pull Request](./actions/common/close-pull-request) | Closes a pull request | [actions-common-close-pull-request-v1.5.9](https://github.com/TimSchoenle/actions/releases/tag/actions-common-close-pull-request-v1.5.9) | `uses: TimSchoenle/actions/actions/common/close-pull-request@8da2713994ba2b5f542e7e3334db287b1e22854a # tag=actions-common-close-pull-request-v1.5.9` |
| [Commit Changes](./actions/common/commit-changes) | Commits changes using the GitHub API to ensure verified bot commits. | [actions-common-commit-changes-v2.0.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-commit-changes-v2.0.0) | `uses: TimSchoenle/actions/actions/common/commit-changes@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-common-commit-changes-v2.0.0` |
| [Common Commit Patch](./actions/common/commit-patch) | Commits a common/create-patch artifact from the same run as a verified commit, refusing any path outside allowed_paths, under .github/workflows/ or below a symbolic link. | [actions-common-commit-patch-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-commit-patch-v1.1.0) | `uses: TimSchoenle/actions/actions/common/commit-patch@bbc2c5e2a0f9345cb2e84946846736f047a6eae3 # tag=actions-common-commit-patch-v1.1.0` |
| [Common Create Patch](./actions/common/create-patch) | Uploads the working-tree changes as a binary git patch against HEAD, for common/commit-patch to commit from a job that runs no repository code. | [actions-common-create-patch-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-create-patch-v1.1.0) | `uses: TimSchoenle/actions/actions/common/create-patch@bbc2c5e2a0f9345cb2e84946846736f047a6eae3 # tag=actions-common-create-patch-v1.1.0` |
| [Common Modify YAML](./actions/common/modify-yaml) | A action to modify a value in a YAML file while strictly preserving comments and structure | [actions-common-modify-yaml-v1.5.8](https://github.com/TimSchoenle/actions/releases/tag/actions-common-modify-yaml-v1.5.8) | `uses: TimSchoenle/actions/actions/common/modify-yaml@8da2713994ba2b5f542e7e3334db287b1e22854a # tag=actions-common-modify-yaml-v1.5.8` |
| [Common Read YAML](./actions/common/read-yaml) | A action to read a value from a YAML file using dot notation | [actions-common-read-yaml-v1.3.9](https://github.com/TimSchoenle/actions/releases/tag/actions-common-read-yaml-v1.3.9) | `uses: TimSchoenle/actions/actions/common/read-yaml@8da2713994ba2b5f542e7e3334db287b1e22854a # tag=actions-common-read-yaml-v1.3.9` |
| [Common Readme Variables](./actions/common/readme-variables) | Collect the standard README render payload — repository facts, release, toolchain and a docs index — as strict JSON for render-template | [actions-common-readme-variables-v1.2.9](https://github.com/TimSchoenle/actions/releases/tag/actions-common-readme-variables-v1.2.9) | `uses: TimSchoenle/actions/actions/common/readme-variables@8da2713994ba2b5f542e7e3334db287b1e22854a # tag=actions-common-readme-variables-v1.2.9` |
| [Create Branch](./actions/common/create-branch) | Creates or resets a git branch using GitHub API. | [actions-common-create-branch-v1.6.9](https://github.com/TimSchoenle/actions/releases/tag/actions-common-create-branch-v1.6.9) | `uses: TimSchoenle/actions/actions/common/create-branch@8da2713994ba2b5f542e7e3334db287b1e22854a # tag=actions-common-create-branch-v1.6.9` |
| [Create Pull Request](./actions/common/create-pull-request) | Creates or updates a pull request using GitHub App authentication with optional branch reset. | [actions-common-create-pull-request-v1.0.28](https://github.com/TimSchoenle/actions/releases/tag/actions-common-create-pull-request-v1.0.28) | `uses: TimSchoenle/actions/actions/common/create-pull-request@81e4009704e0963651bbd8275e31244c1d1e220d # tag=actions-common-create-pull-request-v1.0.28` |
| [Delete-Branch](./actions/common/delete-branch) | Deletes a branch from a repository. Fails gracefully if the branch does not exist. | [actions-common-delete-branch-v1.5.9](https://github.com/TimSchoenle/actions/releases/tag/actions-common-delete-branch-v1.5.9) | `uses: TimSchoenle/actions/actions/common/delete-branch@8da2713994ba2b5f542e7e3334db287b1e22854a # tag=actions-common-delete-branch-v1.5.9` |
| [Get App Git Identity](./actions/common/get-app-git-identity) | Resolves the git identity (username, email, user ID) for a GitHub App bot. | [actions-common-get-app-git-identity-v1.5.9](https://github.com/TimSchoenle/actions/releases/tag/actions-common-get-app-git-identity-v1.5.9) | `uses: TimSchoenle/actions/actions/common/get-app-git-identity@8da2713994ba2b5f542e7e3334db287b1e22854a # tag=actions-common-get-app-git-identity-v1.5.9` |
| [Render Template](./actions/common/render-template) | A action to render a Handlebars template file to an output file from a JSON map of variables, deterministically | [actions-common-render-template-v2.0.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-render-template-v2.0.0) | `uses: TimSchoenle/actions/actions/common/render-template@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-common-render-template-v2.0.0` |
| [Render Template And Commit](./actions/common/render-template-and-commit) | Renders a Handlebars template to a file and commits the result as a verified bot commit, skipping the commit when the render changed nothing. | [actions-common-render-template-and-commit-v1.1.18](https://github.com/TimSchoenle/actions/releases/tag/actions-common-render-template-and-commit-v1.1.18) | `uses: TimSchoenle/actions/actions/common/render-template-and-commit@ea4465fbe2bec98efad19b63849f8d1ac67b5c88 # tag=actions-common-render-template-and-commit-v1.1.18` |
| [Setup App Git Identity](./actions/common/setup-app-git-identity) | Configures git with the identity of a GitHub App bot and outputs the bot details. | [actions-common-setup-app-git-identity-v1.5.9](https://github.com/TimSchoenle/actions/releases/tag/actions-common-setup-app-git-identity-v1.5.9) | `uses: TimSchoenle/actions/actions/common/setup-app-git-identity@8da2713994ba2b5f542e7e3334db287b1e22854a # tag=actions-common-setup-app-git-identity-v1.5.9` |
| [Upsert Issue](./actions/common/upsert-issue) | Opens or updates a repository issue, updating the previous issue carrying the same identifier. | [actions-common-upsert-issue-v1.1.8](https://github.com/TimSchoenle/actions/releases/tag/actions-common-upsert-issue-v1.1.8) | `uses: TimSchoenle/actions/actions/common/upsert-issue@8da2713994ba2b5f542e7e3334db287b1e22854a # tag=actions-common-upsert-issue-v1.1.8` |
| [Upsert PR Comment](./actions/common/upsert-pr-comment) | Posts a comment on a pull request, updating the previous comment carrying the same identifier. | [actions-common-upsert-pr-comment-v1.3.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-upsert-pr-comment-v1.3.0) | `uses: TimSchoenle/actions/actions/common/upsert-pr-comment@9414b1c665d3676efe832978d4e1728cf53119fd # tag=actions-common-upsert-pr-comment-v1.3.0` |

#### Docker

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Docker Image Check](./actions/docker/image-check) | Measures a locally loaded image, warns past a size threshold, scans it with Trivy, uploads the SARIF to code scanning and reports the result on the pull request. | [actions-docker-image-check-v1.1.8](https://github.com/TimSchoenle/actions/releases/tag/actions-docker-image-check-v1.1.8) | `uses: TimSchoenle/actions/actions/docker/image-check@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-docker-image-check-v1.1.8` |
| [Docker Image Check Summary](./actions/docker/image-check-summary) | Collects the fragments docker/image-check legs uploaded with comment: summary and posts one table of every image on the pull request. | [actions-docker-image-check-summary-v2.0.0](https://github.com/TimSchoenle/actions/releases/tag/actions-docker-image-check-summary-v2.0.0) | `uses: TimSchoenle/actions/actions/docker/image-check-summary@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-docker-image-check-summary-v2.0.0` |

#### Helm

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Apply Helm Chart Updates](./actions/helm/apply-chart-updates) | Applies a set of templated image updates to a Helm chart's values.yaml and bumps Chart.yaml, preserving comments and structure. Every image carries its own version and digest. | [actions-helm-apply-chart-updates-v1.3.9](https://github.com/TimSchoenle/actions/releases/tag/actions-helm-apply-chart-updates-v1.3.9) | `uses: TimSchoenle/actions/actions/helm/apply-chart-updates@8da2713994ba2b5f542e7e3334db287b1e22854a # tag=actions-helm-apply-chart-updates-v1.3.9` |
| [Update Helm Chart Version](./actions/helm/update-chart-version) | Updates a Helm chart's image tags, version and appVersion, then opens a Pull Request. Every image carries its own version and digest, so one call can move a chart with many services. This action requires a bot account with access to the charts repo. | [actions-helm-update-chart-version-v1.7.2](https://github.com/TimSchoenle/actions/releases/tag/actions-helm-update-chart-version-v1.7.2) | `uses: TimSchoenle/actions/actions/helm/update-chart-version@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-helm-update-chart-version-v1.7.2` |

#### Helper

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Helper Verify-branch-name](./actions/helper/verify-branch-name) | Verify the head branch of a pull request matches a pattern and check whether it comes from a fork | [actions-helper-verify-branch-name-v1.4.9](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-verify-branch-name-v1.4.9) | `uses: TimSchoenle/actions/actions/helper/verify-branch-name@8da2713994ba2b5f542e7e3334db287b1e22854a # tag=actions-helper-verify-branch-name-v1.4.9` |
| [Resolve Branch](./actions/helper/resolve-base-branch) | Resolve the given base branch or return default branch. With optional existence check. | [actions-helper-resolve-base-branch-v1.5.9](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-resolve-base-branch-v1.5.9) | `uses: TimSchoenle/actions/actions/helper/resolve-base-branch@8da2713994ba2b5f542e7e3334db287b1e22854a # tag=actions-helper-resolve-base-branch-v1.5.9` |
| [Verify Commit Authors](./actions/helper/verify-commit-authors) | Verifies that every commit in a PR is authored by a specific set of users and is either signed by GitHub or committed and signed by one of those users. | [actions-helper-verify-commit-authors-v2.0.0](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-verify-commit-authors-v2.0.0) | `uses: TimSchoenle/actions/actions/helper/verify-commit-authors@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-helper-verify-commit-authors-v2.0.0` |

#### Java-gradle

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Java-gradle Auto-spotless](./actions/java-gradle/auto-spotless) | Runs Gradle spotlessApply and uploads the changes as a patch artifact for common/commit-patch to commit from a separate job. Holds no token. | [actions-java-gradle-auto-spotless-v1.1.33](https://github.com/TimSchoenle/actions/releases/tag/actions-java-gradle-auto-spotless-v1.1.33) | `uses: TimSchoenle/actions/actions/java-gradle/auto-spotless@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-java-gradle-auto-spotless-v1.1.33` |
| [Java-Gradle Coverage (Codecov)](./actions/java-gradle/coverage-codecov) | Action that measures Java and Kotlin test coverage with JaCoCo through Gradle, and uploads the coverage reports and the JUnit test results to Codecov. | [actions-java-gradle-coverage-codecov-v1.1.2](https://github.com/TimSchoenle/actions/releases/tag/actions-java-gradle-coverage-codecov-v1.1.2) | `uses: TimSchoenle/actions/actions/java-gradle/coverage-codecov@8da2713994ba2b5f542e7e3334db287b1e22854a # tag=actions-java-gradle-coverage-codecov-v1.1.2` |
| [Java-Gradle default setup](./actions/java-gradle/setup-base-environment) | Setup Java and Gradle environment for building, with opinionated default settings | [actions-java-gradle-setup-base-environment-v1.2.14](https://github.com/TimSchoenle/actions/releases/tag/actions-java-gradle-setup-base-environment-v1.2.14) | `uses: TimSchoenle/actions/actions/java-gradle/setup-base-environment@8da2713994ba2b5f542e7e3334db287b1e22854a # tag=actions-java-gradle-setup-base-environment-v1.2.14` |

#### Maintenance

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Maintenance Auto-approve-pr](./actions/maintenance/auto-approve-pr) | Auto approve Pull Requests with the given user ids and branches. | [actions-maintenance-auto-approve-pr-v2.0.0](https://github.com/TimSchoenle/actions/releases/tag/actions-maintenance-auto-approve-pr-v2.0.0) | `uses: TimSchoenle/actions/actions/maintenance/auto-approve-pr@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-maintenance-auto-approve-pr-v2.0.0` |
| [Maintenance Auto-rebase](./actions/maintenance/auto-rebase) | Updates every open pull request carrying a label with the latest commits of its base branch, through the update-branch API, which merges the base into the head. | [actions-maintenance-auto-rebase-v2.0.0](https://github.com/TimSchoenle/actions/releases/tag/actions-maintenance-auto-rebase-v2.0.0) | `uses: TimSchoenle/actions/actions/maintenance/auto-rebase@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-maintenance-auto-rebase-v2.0.0` |
| [Maintenance Ensure-actions-are-executed](./actions/maintenance/ensure-actions-are-executed) | Ensures selected checks completed successfully when they were started. | [actions-maintenance-ensure-actions-are-executed-v1.5.9](https://github.com/TimSchoenle/actions/releases/tag/actions-maintenance-ensure-actions-are-executed-v1.5.9) | `uses: TimSchoenle/actions/actions/maintenance/ensure-actions-are-executed@8da2713994ba2b5f542e7e3334db287b1e22854a # tag=actions-maintenance-ensure-actions-are-executed-v1.5.9` |
| [Maintenance Timed-auto-merge](./actions/maintenance/timed-auto-merge) | Approve and enable auto-merge on aged pull requests whose head branch matches a pattern and whose commits are all signed by trusted authors. | [actions-maintenance-timed-auto-merge-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-maintenance-timed-auto-merge-v1.1.0) | `uses: TimSchoenle/actions/actions/maintenance/timed-auto-merge@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-maintenance-timed-auto-merge-v1.1.0` |
| [Maintenance Wipe-cache](./actions/maintenance/wipe-cache) | Deletes every GitHub Actions cache entry recorded for one branch. Refuses the default branch unless allow_default_branch is true. | [actions-maintenance-wipe-cache-v2.0.0](https://github.com/TimSchoenle/actions/releases/tag/actions-maintenance-wipe-cache-v2.0.0) | `uses: TimSchoenle/actions/actions/maintenance/wipe-cache@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-maintenance-wipe-cache-v2.0.0` |

#### Rust

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Rust Auto-format](./actions/rust/auto-format) | Runs cargo fmt and uploads the changes as a patch artifact for common/commit-patch to commit from a separate job. Holds no token. | [actions-rust-auto-format-v1.1.25](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-auto-format-v1.1.25) | `uses: TimSchoenle/actions/actions/rust/auto-format@81e4009704e0963651bbd8275e31244c1d1e220d # tag=actions-rust-auto-format-v1.1.25` |
| [Rust Cargo-check](./actions/rust/cargo-check) | Action that runs cargo check to verify Rust code compiles without errors. | [actions-rust-cargo-check-v1.1.7](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-cargo-check-v1.1.7) | `uses: TimSchoenle/actions/actions/rust/cargo-check@88e964d440835fd99f7e9d17b4ba1b48544303ba # tag=actions-rust-cargo-check-v1.1.7` |
| [Rust Clippy](./actions/rust/clippy) | Action that runs clippy to catch common mistakes and improve your Rust code. | [actions-rust-clippy-v1.1.13](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-clippy-v1.1.13) | `uses: TimSchoenle/actions/actions/rust/clippy@ea4465fbe2bec98efad19b63849f8d1ac67b5c88 # tag=actions-rust-clippy-v1.1.13` |
| [Rust Config Contract](./actions/rust/config-contract) | Action that checks a terrace-config contract, its Dockerfile LABEL block and a built image against the configuration types they claim to describe. | [actions-rust-config-contract-v1.4.0](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-config-contract-v1.4.0) | `uses: TimSchoenle/actions/actions/rust/config-contract@ea4465fbe2bec98efad19b63849f8d1ac67b5c88 # tag=actions-rust-config-contract-v1.4.0` |
| [Rust Coverage (Codecov)](./actions/rust/coverage-codecov) | Action that measures Rust test coverage with cargo llvm-cov and nextest, and uploads the coverage report and the JUnit test results to Codecov. | [actions-rust-coverage-codecov-v2.0.4](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-coverage-codecov-v2.0.4) | `uses: TimSchoenle/actions/actions/rust/coverage-codecov@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-rust-coverage-codecov-v2.0.4` |
| [Rust Test](./actions/rust/test) | Action that runs cargo nextest to verify Rust code passes tests. | [actions-rust-test-v1.1.2](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-test-v1.1.2) | `uses: TimSchoenle/actions/actions/rust/test@e16a1e466faf8ec751b26289c1898143a253269f # tag=actions-rust-test-v1.1.2` |

#### Security

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Security CodeQL](./actions/security/codeql) | Runs CodeQL on one language with build-mode none, excluding test sources so fixtures and assertion messages do not raise alerts, and uploads the result to code scanning. | [actions-security-codeql-v1.1.5](https://github.com/TimSchoenle/actions/releases/tag/actions-security-codeql-v1.1.5) | `uses: TimSchoenle/actions/actions/security/codeql@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-security-codeql-v1.1.5` |
| [Security Zizmor](./actions/security/zizmor) | Runs zizmor over workflows and actions with strict collection, uploads the SARIF to code scanning under the category zizmor, and fails the job on an input zizmor cannot parse or a finding at or above a severity. | [actions-security-zizmor-v2.0.0](https://github.com/TimSchoenle/actions/releases/tag/actions-security-zizmor-v2.0.0) | `uses: TimSchoenle/actions/actions/security/zizmor@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-security-zizmor-v2.0.0` |

#### Terrace

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Terrace Helm Check](./actions/terrace/helm-check) | Runs every offline configuration contract gate over the charts a change touched, with terrace-contract sync --check. Findings become annotations and a job summary. Writes nothing and needs no write token. | [actions-terrace-helm-check-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-terrace-helm-check-v1.1.0) | `uses: TimSchoenle/actions/actions/terrace/helm-check@81e4009704e0963651bbd8275e31244c1d1e220d # tag=actions-terrace-helm-check-v1.1.0` |
| [Terrace Helm Diff](./actions/terrace/helm-diff) | Reports how the vendored configuration contracts changed against a base revision and what each change costs the charts, with terrace-contract diff. The report goes to the job summary and, given a token, into one pull request comment that later runs update. Never fails on differences. | [actions-terrace-helm-diff-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-terrace-helm-diff-v1.1.0) | `uses: TimSchoenle/actions/actions/terrace/helm-diff@81e4009704e0963651bbd8275e31244c1d1e220d # tag=actions-terrace-helm-diff-v1.1.0` |
| [Terrace Helm Sync](./actions/terrace/helm-sync) | Brings every file derived from the vendored configuration contracts up to date with terrace-contract sync: pulls each contract from the image its chart pins, then rewrites the value schemas and README credential references. Given a token, commits the result to the branch as a verified commit. | [actions-terrace-helm-sync-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-terrace-helm-sync-v1.1.0) | `uses: TimSchoenle/actions/actions/terrace/helm-sync@81e4009704e0963651bbd8275e31244c1d1e220d # tag=actions-terrace-helm-sync-v1.1.0` |
| [Terrace Image](./actions/terrace/image) | Holds a service image to the configuration contract its build produced, in any language: the document against the specification, the committed document against its generator, the Dockerfile label block against the document, and the built image itself, read through oras. Optionally attaches the document to the image digest and signs it. | [actions-terrace-image-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-terrace-image-v1.1.0) | `uses: TimSchoenle/actions/actions/terrace/image@ea4465fbe2bec98efad19b63849f8d1ac67b5c88 # tag=actions-terrace-image-v1.1.0` |
| [Terrace Setup](./actions/terrace/setup) | Installs a signature-verified terrace-contract release on PATH, together with cosign and, when asked, oras. The version comes from the version input or from the cli pin in terrace.yaml. | [actions-terrace-setup-v2.0.0](https://github.com/TimSchoenle/actions/releases/tag/actions-terrace-setup-v2.0.0) | `uses: TimSchoenle/actions/actions/terrace/setup@9d5cb31939ace7a3d3d7f452052724337c65f153 # tag=actions-terrace-setup-v2.0.0` |

#### Test

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Setup E2E Test](./actions/test/setup-e2e) | Sets up the environment for E2E testing: generates token, checks out test repo, and checks out actions code. | [actions-test-setup-e2e-v1.2.4](https://github.com/TimSchoenle/actions/releases/tag/actions-test-setup-e2e-v1.2.4) | `uses: TimSchoenle/actions/actions/test/setup-e2e@5f23e7ecae779a09b699ce2983ec5e49e5f2b0a5 # tag=actions-test-setup-e2e-v1.2.4` |



### Reusable workflows

Releasing one of these publishes it onto its tag at `.github/workflows/<category>-<name>.yaml`,
which is the path the `uses:` line resolves. Read and change the source under `workflows/`.

#### Maintenance

| Workflow | Description | Version | Usage |
| --- | --- | --- | --- |
| [Auto Format](./workflows/maintenance/auto-bun-prettier) | Reusable workflow to auto-format code by running a "bun run" script and commit changes. | [workflows-maintenance-auto-bun-prettier-v1.1.43](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-bun-prettier-v1.1.43) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-bun-prettier.yaml@2500adaa53c588c7dff4dfb89d2831367b416c34 # tag=workflows-maintenance-auto-bun-prettier-v1.1.43` |
| [Auto-Approve & Merge Timed PRs](./workflows/maintenance/timed-auto-pr-approve) | Reusable workflow that automatically verifies, approves, and merges Pull Requests that match a specific branch pattern and have been open for a configurable duration. It ensures all commits are signed and authored by trusted users. | [workflows-maintenance-timed-auto-pr-approve-v1.2.45](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-timed-auto-pr-approve-v1.2.45) | `uses: TimSchoenle/actions/.github/workflows/maintenance-timed-auto-pr-approve.yaml@87a8aa7d345eb8215f655b5e47b029f3bf8e46f1 # tag=workflows-maintenance-timed-auto-pr-approve-v1.2.45` |
| [Maintenance Auto-approve-renovate](./workflows/maintenance/auto-approve-renovate) | Reusable workflow to auto approve Renovate PRs, this is useful to auto merge Renovate PRs which have auto-merge enabled. | [workflows-maintenance-auto-approve-renovate-v1.4.32](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-approve-renovate-v1.4.32) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-approve-renovate.yaml@27e020480d2c7c41694065b53a6565817e67680a # tag=workflows-maintenance-auto-approve-renovate-v1.4.32` |
| [Maintenance Auto-rebase](./workflows/maintenance/auto-rebase) | Automatically rebases open PRs with a given label. | [workflows-maintenance-auto-rebase-v1.1.8](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-rebase-v1.1.8) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-rebase.yaml@7cf01346e7636298556c46cd8fc1a96b50006d59 # tag=workflows-maintenance-auto-rebase-v1.1.8` |
| [Maintenance Wipe-cache](./workflows/maintenance/wipe-cache) | Workflow to wipe all cache entries for the given branch. | [workflows-maintenance-wipe-cache-v1.1.14](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-wipe-cache-v1.1.14) | `uses: TimSchoenle/actions/.github/workflows/maintenance-wipe-cache.yaml@d10d04659020a6fbb4e4f7ecaa6b829e51a0bb97 # tag=workflows-maintenance-wipe-cache-v1.1.14` |



### Shared configurations

The Renovate presets are consumed through `extends`. The ruleset files are GitHub's own export
format: download one and import it under the repository's Settings, then Rules.

Each Checkstyle ruleset lives in its own directory under `configs/checkstyle/`, alongside a
`configs/checkstyle/_shared/` directory holding Lombok-annotation suppressions common to every
ruleset. Checkstyle's `${config_loc}` is a convention property your build tool sets to a local
directory (Gradle's `checkstyle.configDirectory`, Maven's `propertyExpansion`) — it is never
derived from a remote `configLocation` URL — so a ruleset only resolves its suppression files, its
`../_shared/` sibling included, once you vendor both directories into your project and point your
build tool's config directory at your copy of the ruleset directory.

#### GitHub Rulesets

| Config | Description |
| --- | --- |
| [Default Branch: Default Protection Rules](./configs/github-rulesets/branch-default_default-rules.json) | Enforces standard protection rules on the default branch: requires squash-merged PRs with 1 approval that a new push dismisses, plus an extra approval for unattributed changes, signed commits, CodeQL and zizmor code scanning, and the required status checks listed in scripts/lib/required-checks.ts. |
| [Release Please Branches: Trusted Bots & Admins Only](./configs/github-rulesets/branch-release-please_only-allow-trusted-bots-and-admins.json) | Restricts access to release-please branches, allowing only trusted bots and admins to create, update, or delete them, while enforcing code quality, code scanning and signature requirements. |
| [Release Tags: Only Allow Automatic Release Manager Bot](./configs/github-rulesets/release-tags_only-allow-automatic-release-manager-bot.json) | Enforces that only the Automatic Release Manager bot can create, update, or delete release tags. |
| [Renovate Branches: Trusted Bots & Admins Only](./configs/github-rulesets/branch-renovate_only-allow-trusted-bots-and-admins.json) | Restricts access to Renovate branches, allowing only trusted bots (Renovate and the repository's GitHub Apps) and admins to manage them, while enforcing code quality, code scanning and signature requirements. |


#### Renovate

| Config | Description | Usage |
| --- | --- | --- |
| [actions](./configs/renovate/actions.json) | Versioning rules for all custom Github Actions defined in this repository | `"extends": ["github>TimSchoenle/actions//configs/renovate/actions"]` |
| [base](./configs/renovate/base.json) | Base configuration to handle custom versioning for all resources in this repository. | `"extends": ["github>TimSchoenle/actions//configs/renovate/base"]` |
| [ci-automerge](./configs/renovate/ci-automerge.json) | Auto-merge rules for all none major Github Actions including custom actions defined in this repository. | `"extends": ["github>TimSchoenle/actions//configs/renovate/ci-automerge"]` |
| [default](./configs/renovate/default.json) | Default configuration for Renovate | `"extends": ["github>TimSchoenle/actions//configs/renovate/default"]` |
| [rust-application](./configs/renovate/rust-application.json) | Rust applications: rust-toolchain plus `rust-version` in every Cargo.toml, moved in the same `rust toolchain` pull request. Not for libraries: there `rust-version` is the MSRV, a compatibility promise raised by decision, not a pin to keep current. | `"extends": ["github>TimSchoenle/actions//configs/renovate/rust-application"]` |
| [rust-toolchain](./configs/renovate/rust-toolchain.json) | Rust toolchain for any Rust repository: `channel` in rust-toolchain.toml and every `rust` Docker image tag move in one pull request that cannot ship half-done. Never touches `rust-version` in Cargo.toml; applications that want it moved too extend rust-application instead. | `"extends": ["github>TimSchoenle/actions//configs/renovate/rust-toolchain"]` |
| [workflows](./configs/renovate/workflows.json) | Versioning rules for all custom Reusable Workflows defined in this repository | `"extends": ["github>TimSchoenle/actions//configs/renovate/workflows"]` |


#### Checkstyle

| Config | Description | Version |
| --- | --- | --- |
| [Application](./configs/checkstyle/application/checkstyle.xml) | Latest Palantir Baseline Checkstyle plus strict final locals/parameters, explicit `this` qualification, and Lombok-annotation-aware suppressions, for application and service code. Unlike the Library ruleset, it omits DesignForExtension and JavadocMethod since this code has no public API surface to document or keep extension-safe. | [configs-checkstyle-application-v1.0.2](https://github.com/TimSchoenle/actions/releases/tag/configs-checkstyle-application-v1.0.2) |
| [Library](./configs/checkstyle/library/checkstyle.xml) | Latest Palantir Baseline Checkstyle plus strict final locals/parameters, explicit `this` qualification, and Lombok-annotation-aware suppressions. Enforces DesignForExtension and a strengthened JavadocMethod so every public and protected member of the library's API is documented and safe to extend. | [configs-checkstyle-library-v1.0.2](https://github.com/TimSchoenle/actions/releases/tag/configs-checkstyle-library-v1.0.2) |

##### Application

Vendor `configs/checkstyle/application/` and `configs/checkstyle/_shared/` into your project, then point your build tool's config directory (Gradle `configDirectory`, Maven `config_loc`) at your copy of `configs/checkstyle/application/`. Or depend on it directly via [JitPack](https://jitpack.io), no vendoring or config directory required:

**Gradle (Kotlin DSL)**

```kotlin
val checkstyleConfig: Configuration by configurations.creating

repositories {
    maven { url = uri("https://jitpack.io") }
}

checkstyle {
    toolVersion = "<your checkstyle version>"
    config = resources.text.fromArchiveEntry(checkstyleConfig, "checkstyle.xml")
}

dependencies {
    checkstyleConfig("de.timscho.actions:checkstyle-application:configs-checkstyle-application-v1.0.2")
    checkstyle("de.timscho.actions:checkstyle-application:configs-checkstyle-application-v1.0.2")
    checkstyle("com.puppycrawl.tools:checkstyle:${checkstyle.toolVersion}")
}
```

**Maven**

```xml
<repositories>
  <repository>
    <id>jitpack.io</id>
    <url>https://jitpack.io</url>
  </repository>
</repositories>

<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-checkstyle-plugin</artifactId>
      <configuration>
        <configLocation>checkstyle.xml</configLocation>
      </configuration>
      <dependencies>
        <dependency>
          <groupId>de.timscho.actions</groupId>
          <artifactId>checkstyle-application</artifactId>
          <version>configs-checkstyle-application-v1.0.2</version>
        </dependency>
      </dependencies>
    </plugin>
  </plugins>
</build>
```

##### Library

Vendor `configs/checkstyle/library/` and `configs/checkstyle/_shared/` into your project, then point your build tool's config directory (Gradle `configDirectory`, Maven `config_loc`) at your copy of `configs/checkstyle/library/`. Or depend on it directly via [JitPack](https://jitpack.io), no vendoring or config directory required:

**Gradle (Kotlin DSL)**

```kotlin
val checkstyleConfig: Configuration by configurations.creating

repositories {
    maven { url = uri("https://jitpack.io") }
}

checkstyle {
    toolVersion = "<your checkstyle version>"
    config = resources.text.fromArchiveEntry(checkstyleConfig, "checkstyle.xml")
}

dependencies {
    checkstyleConfig("de.timscho.actions:checkstyle-library:configs-checkstyle-library-v1.0.2")
    checkstyle("de.timscho.actions:checkstyle-library:configs-checkstyle-library-v1.0.2")
    checkstyle("com.puppycrawl.tools:checkstyle:${checkstyle.toolVersion}")
}
```

**Maven**

```xml
<repositories>
  <repository>
    <id>jitpack.io</id>
    <url>https://jitpack.io</url>
  </repository>
</repositories>

<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-checkstyle-plugin</artifactId>
      <configuration>
        <configLocation>checkstyle.xml</configLocation>
      </configuration>
      <dependencies>
        <dependency>
          <groupId>de.timscho.actions</groupId>
          <artifactId>checkstyle-library</artifactId>
          <version>configs-checkstyle-library-v1.0.2</version>
        </dependency>
      </dependencies>
    </plugin>
  </plugins>
</build>
```



## Documentation

`docs/` holds the two writing standards every repository in this account is held to. Other
repositories link them from their own `CONTRIBUTING.md` instead of keeping a copy.

| Document | Purpose |
| --- | --- |
| [docs/readme/README.md](docs/readme/README.md) | What a README contains and in what order, how its prose is written, the template it starts from and the CI job that keeps it rendered. |
| [docs/doc-comments/README.md](docs/doc-comments/README.md) | What carries a doc comment and what it says, with an annex each for Rust, Java and TypeScript. |

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the commit
convention release-please reads, the interactive generators that scaffold a new action or workflow,
and the checks CI runs. This file and SECURITY.md are generated. An edit to either is reverted on
the next pull request.

## Security

Do not open a public issue for a vulnerability. [SECURITY.md](SECURITY.md) has the private reporting
route and the list of supported versions.

## License

Every action, workflow and config here is published under the terms in [LICENSE](LICENSE).
