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
| [Bun Setup-cached](./actions/bun/setup-cached) | Sets up Bun and manages dependency caching. | [actions-bun-setup-cached-v1.1.11](https://github.com/TimSchoenle/actions/releases/tag/actions-bun-setup-cached-v1.1.11) | `uses: TimSchoenle/actions/actions/bun/setup-cached@e16a1e466faf8ec751b26289c1898143a253269f # tag=actions-bun-setup-cached-v1.1.11` |

#### Common

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Close Pull Request](./actions/common/close-pull-request) | Closes a pull request | [actions-common-close-pull-request-v1.4.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-close-pull-request-v1.4.1) | `uses: TimSchoenle/actions/actions/common/close-pull-request@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-common-close-pull-request-v1.4.1` |
| [Commit Changes](./actions/common/commit-changes) | Commits changes using the GitHub API to ensure verified bot commits. | [actions-common-commit-changes-v1.4.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-commit-changes-v1.4.1) | `uses: TimSchoenle/actions/actions/common/commit-changes@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-common-commit-changes-v1.4.1` |
| [Common Modify YAML](./actions/common/modify-yaml) | A action to modify a value in a YAML file while strictly preserving comments and structure | [actions-common-modify-yaml-v1.4.5](https://github.com/TimSchoenle/actions/releases/tag/actions-common-modify-yaml-v1.4.5) | `uses: TimSchoenle/actions/actions/common/modify-yaml@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-common-modify-yaml-v1.4.5` |
| [Common Read YAML](./actions/common/read-yaml) | A action to read a value from a YAML file using dot notation | [actions-common-read-yaml-v1.2.3](https://github.com/TimSchoenle/actions/releases/tag/actions-common-read-yaml-v1.2.3) | `uses: TimSchoenle/actions/actions/common/read-yaml@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-common-read-yaml-v1.2.3` |
| [Common Readme Variables](./actions/common/readme-variables) | Collect the standard README render payload — repository facts, release, toolchain and a docs index — as strict JSON for render-template | [actions-common-readme-variables-v1.1.2](https://github.com/TimSchoenle/actions/releases/tag/actions-common-readme-variables-v1.1.2) | `uses: TimSchoenle/actions/actions/common/readme-variables@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-common-readme-variables-v1.1.2` |
| [Create Branch](./actions/common/create-branch) | Creates or resets a git branch using GitHub API. | [actions-common-create-branch-v1.5.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-create-branch-v1.5.1) | `uses: TimSchoenle/actions/actions/common/create-branch@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-common-create-branch-v1.5.1` |
| [Create Pull Request](./actions/common/create-pull-request) | Creates or updates a pull request using GitHub App authentication with optional branch reset. | [actions-common-create-pull-request-v1.0.14](https://github.com/TimSchoenle/actions/releases/tag/actions-common-create-pull-request-v1.0.14) | `uses: TimSchoenle/actions/actions/common/create-pull-request@0406974974a3aaf884e7c65866b091d266614b46 # tag=actions-common-create-pull-request-v1.0.14` |
| [Delete-Branch](./actions/common/delete-branch) | Deletes a branch from a repository. Fails gracefully if the branch does not exist. | [actions-common-delete-branch-v1.4.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-delete-branch-v1.4.1) | `uses: TimSchoenle/actions/actions/common/delete-branch@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-common-delete-branch-v1.4.1` |
| [Get App Git Identity](./actions/common/get-app-git-identity) | Resolves the git identity (username, email, user ID) for a GitHub App bot. | [actions-common-get-app-git-identity-v1.4.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-get-app-git-identity-v1.4.1) | `uses: TimSchoenle/actions/actions/common/get-app-git-identity@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-common-get-app-git-identity-v1.4.1` |
| [Render Template](./actions/common/render-template) | A action to render a Handlebars template file to an output file from a JSON map of variables, deterministically | [actions-common-render-template-v1.1.3](https://github.com/TimSchoenle/actions/releases/tag/actions-common-render-template-v1.1.3) | `uses: TimSchoenle/actions/actions/common/render-template@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-common-render-template-v1.1.3` |
| [Render Template And Commit](./actions/common/render-template-and-commit) | Renders a Handlebars template to a file and commits the result as a verified bot commit, skipping the commit when the render changed nothing. | [actions-common-render-template-and-commit-v1.1.5](https://github.com/TimSchoenle/actions/releases/tag/actions-common-render-template-and-commit-v1.1.5) | `uses: TimSchoenle/actions/actions/common/render-template-and-commit@0406974974a3aaf884e7c65866b091d266614b46 # tag=actions-common-render-template-and-commit-v1.1.5` |
| [Setup App Git Identity](./actions/common/setup-app-git-identity) | Configures git with the identity of a GitHub App bot and outputs the bot details. | [actions-common-setup-app-git-identity-v1.4.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-setup-app-git-identity-v1.4.1) | `uses: TimSchoenle/actions/actions/common/setup-app-git-identity@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-common-setup-app-git-identity-v1.4.1` |

#### Helm

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Apply Helm Chart Updates](./actions/helm/apply-chart-updates) | Applies a set of templated image updates to a Helm chart's values.yaml and bumps Chart.yaml, preserving comments and structure. Every image carries its own version and digest. | [actions-helm-apply-chart-updates-v1.2.3](https://github.com/TimSchoenle/actions/releases/tag/actions-helm-apply-chart-updates-v1.2.3) | `uses: TimSchoenle/actions/actions/helm/apply-chart-updates@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-helm-apply-chart-updates-v1.2.3` |
| [Update Helm Chart Version](./actions/helm/update-chart-version) | Updates a Helm chart's image tags, version and appVersion, then opens a Pull Request. Every image carries its own version and digest, so one call can move a chart with many services. This action requires a bot account with access to the charts repo. | [actions-helm-update-chart-version-v1.6.6](https://github.com/TimSchoenle/actions/releases/tag/actions-helm-update-chart-version-v1.6.6) | `uses: TimSchoenle/actions/actions/helm/update-chart-version@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-helm-update-chart-version-v1.6.6` |

#### Helper

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Helper Verify-branch-name](./actions/helper/verify-branch-name) | Verify the head branch of a pull request matches a pattern and check whether it comes from a fork | [actions-helper-verify-branch-name-v1.3.4](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-verify-branch-name-v1.3.4) | `uses: TimSchoenle/actions/actions/helper/verify-branch-name@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-helper-verify-branch-name-v1.3.4` |
| [Resolve Branch](./actions/helper/resolve-base-branch) | Resolve the given base branch or return default branch. With optional existence check. | [actions-helper-resolve-base-branch-v1.4.1](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-resolve-base-branch-v1.4.1) | `uses: TimSchoenle/actions/actions/helper/resolve-base-branch@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-helper-resolve-base-branch-v1.4.1` |
| [Verify Commit Authors](./actions/helper/verify-commit-authors) | Verifies that all commits in a PR are authored by a specific set of users and are signed. | [actions-helper-verify-commit-authors-v1.4.1](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-verify-commit-authors-v1.4.1) | `uses: TimSchoenle/actions/actions/helper/verify-commit-authors@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-helper-verify-commit-authors-v1.4.1` |

#### Java-gradle

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Java-gradle Auto-spotless](./actions/java-gradle/auto-spotless) | Automatically apply spotless formatting and commit changes. | [actions-java-gradle-auto-spotless-v1.1.19](https://github.com/TimSchoenle/actions/releases/tag/actions-java-gradle-auto-spotless-v1.1.19) | `uses: TimSchoenle/actions/actions/java-gradle/auto-spotless@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-java-gradle-auto-spotless-v1.1.19` |
| [Java-Gradle default setup](./actions/java-gradle/setup-base-environment) | Setup Java and Gradle environment for building, with opinionated default settings | [actions-java-gradle-setup-base-environment-v1.2.11](https://github.com/TimSchoenle/actions/releases/tag/actions-java-gradle-setup-base-environment-v1.2.11) | `uses: TimSchoenle/actions/actions/java-gradle/setup-base-environment@0406974974a3aaf884e7c65866b091d266614b46 # tag=actions-java-gradle-setup-base-environment-v1.2.11` |

#### Maintenance

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Maintenance Auto-approve-pr](./actions/maintenance/auto-approve-pr) | Auto approve Pull Requests with the given user ids and branches. | [actions-maintenance-auto-approve-pr-v1.4.1](https://github.com/TimSchoenle/actions/releases/tag/actions-maintenance-auto-approve-pr-v1.4.1) | `uses: TimSchoenle/actions/actions/maintenance/auto-approve-pr@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-maintenance-auto-approve-pr-v1.4.1` |
| [Maintenance Ensure-actions-are-executed](./actions/maintenance/ensure-actions-are-executed) | Ensures selected checks completed successfully when they were started. | [actions-maintenance-ensure-actions-are-executed-v1.4.1](https://github.com/TimSchoenle/actions/releases/tag/actions-maintenance-ensure-actions-are-executed-v1.4.1) | `uses: TimSchoenle/actions/actions/maintenance/ensure-actions-are-executed@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-maintenance-ensure-actions-are-executed-v1.4.1` |

#### Rust

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Rust Auto-format](./actions/rust/auto-format) | Action that runs cargo fmt and commits changes. | [actions-rust-auto-format-v1.1.13](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-auto-format-v1.1.13) | `uses: TimSchoenle/actions/actions/rust/auto-format@0406974974a3aaf884e7c65866b091d266614b46 # tag=actions-rust-auto-format-v1.1.13` |
| [Rust Cargo-check](./actions/rust/cargo-check) | Action that runs cargo check to verify Rust code compiles without errors. | [actions-rust-cargo-check-v1.1.6](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-cargo-check-v1.1.6) | `uses: TimSchoenle/actions/actions/rust/cargo-check@e16a1e466faf8ec751b26289c1898143a253269f # tag=actions-rust-cargo-check-v1.1.6` |
| [Rust Clippy](./actions/rust/clippy) | Action that runs clippy to catch common mistakes and improve your Rust code. | [actions-rust-clippy-v1.1.10](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-clippy-v1.1.10) | `uses: TimSchoenle/actions/actions/rust/clippy@e16a1e466faf8ec751b26289c1898143a253269f # tag=actions-rust-clippy-v1.1.10` |
| [Rust Config Contract](./actions/rust/config-contract) | Action that checks a terrace-config contract, its Dockerfile LABEL block and a built image against the configuration types they claim to describe. | [actions-rust-config-contract-v1.2.1](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-config-contract-v1.2.1) | `uses: TimSchoenle/actions/actions/rust/config-contract@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-rust-config-contract-v1.2.1` |
| [Rust Coverage (Codecov)](./actions/rust/coverage-codecov) | Action that runs cargo llvm-cov to generate code coverage and uploads to Codecov. | [actions-rust-coverage-codecov-v1.1.43](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-coverage-codecov-v1.1.43) | `uses: TimSchoenle/actions/actions/rust/coverage-codecov@c7e430537b061a61687ed9308048fc319c97a59c # tag=actions-rust-coverage-codecov-v1.1.43` |
| [Rust Test](./actions/rust/test) | Action that runs cargo nextest to verify Rust code passes tests. | [actions-rust-test-v1.1.2](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-test-v1.1.2) | `uses: TimSchoenle/actions/actions/rust/test@e16a1e466faf8ec751b26289c1898143a253269f # tag=actions-rust-test-v1.1.2` |

#### Test

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Setup E2E Test](./actions/test/setup-e2e) | Sets up the environment for E2E testing: generates token, checks out test repo, and checks out actions code. | [actions-test-setup-e2e-v1.2.3](https://github.com/TimSchoenle/actions/releases/tag/actions-test-setup-e2e-v1.2.3) | `uses: TimSchoenle/actions/actions/test/setup-e2e@51bbb07f9ccf8d9f5a8de245e2d6f2812638e989 # tag=actions-test-setup-e2e-v1.2.3` |



### Reusable workflows

Releasing one of these publishes it onto its tag at `.github/workflows/<category>-<name>.yaml`,
which is the path the `uses:` line resolves. Read and change the source under `workflows/`.

#### Maintenance

| Workflow | Description | Version | Usage |
| --- | --- | --- | --- |
| [Auto Format](./workflows/maintenance/auto-bun-prettier) | Reusable workflow to auto-format code by running a "bun run" script and commit changes. | [workflows-maintenance-auto-bun-prettier-v1.1.30](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-bun-prettier-v1.1.30) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-bun-prettier.yaml@04d71fc53d58acfb9a605fcd8f3390269a722b3c # tag=workflows-maintenance-auto-bun-prettier-v1.1.30` |
| [Auto-Approve & Merge Timed PRs](./workflows/maintenance/timed-auto-pr-approve) | Reusable workflow that automatically verifies, approves, and merges Pull Requests that match a specific branch pattern and have been open for a configurable duration. It ensures all commits are signed and authored by trusted users. | [workflows-maintenance-timed-auto-pr-approve-v1.2.34](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-timed-auto-pr-approve-v1.2.34) | `uses: TimSchoenle/actions/.github/workflows/maintenance-timed-auto-pr-approve.yaml@c6af450fd43a26f398f3f46570b1db6343f585f9 # tag=workflows-maintenance-timed-auto-pr-approve-v1.2.34` |
| [Maintenance Auto-approve-renovate](./workflows/maintenance/auto-approve-renovate) | Reusable workflow to auto approve Renovate PRs, this is useful to auto merge Renovate PRs which have auto-merge enabled. | [workflows-maintenance-auto-approve-renovate-v1.4.22](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-approve-renovate-v1.4.22) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-approve-renovate.yaml@26f5def814d8bd12a7e16cd0d89c33aa6958a1bf # tag=workflows-maintenance-auto-approve-renovate-v1.4.22` |
| [Maintenance Auto-rebase](./workflows/maintenance/auto-rebase) | Automatically rebases open PRs with a given label. | [workflows-maintenance-auto-rebase-v1.1.7](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-rebase-v1.1.7) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-rebase.yaml@112057eff67d583e17eda2b173bc5d67eb83fb4f # tag=workflows-maintenance-auto-rebase-v1.1.7` |
| [Maintenance Wipe-cache](./workflows/maintenance/wipe-cache) | Workflow to wipe all cache entries for the given branch. | [workflows-maintenance-wipe-cache-v1.1.13](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-wipe-cache-v1.1.13) | `uses: TimSchoenle/actions/.github/workflows/maintenance-wipe-cache.yaml@103a601a6e8778074ac41d9dd03870d1989463b6 # tag=workflows-maintenance-wipe-cache-v1.1.13` |



### Shared configurations

The Renovate presets are consumed through `extends`. The ruleset files are GitHub's own export
format: download one and import it under the repository's Settings, then Rules.

#### GitHub Rulesets

| Config | Description |
| --- | --- |
| [Default Branch: Default Protection Rules](./configs/github-rulesets/branch-default_default-rules.json) | Enforces standard protection rules on the default branch: requires PRs with 1 approval (squash only), signed commits, CodeQL scanning, and passing status checks. |
| [Release Please Branches: Trusted Bots Only](./configs/github-rulesets/branch-release-please_only-allow-trusted-bots.json) | Restricts access to release-please branches, allowing only trusted bots to create, update, or delete them, while enforcing code quality and signature requirements. |
| [Release Tags: Only Allow Automatic Release Manager Bot](./configs/github-rulesets/release-tags_only-allow-automatic-release-manager-bot.json) | Enforces that only the Automatic Release Manager bot can create, update, or delete release tags. |
| [Renovate Branches: Trusted Bots & Admins Only](./configs/github-rulesets/branch-renovate_only-allow-trusted-bots-and-admins.json) | Restricts access to Renovate branches, allowing only trusted bots (Renovate, Automatic Release Manager) and admins to manage them, while enforcing code quality and signature requirements. |


#### Renovate

| Config | Description | Usage |
| --- | --- | --- |
| [actions](./configs/renovate/actions.json) | Versioning rules for all custom Github Actions defined in this repository | `"extends": ["github>TimSchoenle/actions//configs/renovate/actions"]` |
| [base](./configs/renovate/base.json) | Base configuration to handle custom versioning for all resources in this repository. | `"extends": ["github>TimSchoenle/actions//configs/renovate/base"]` |
| [ci-automerge](./configs/renovate/ci-automerge.json) | Auto-merge rules for all none major Github Actions including custom actions defined in this repository. | `"extends": ["github>TimSchoenle/actions//configs/renovate/ci-automerge"]` |
| [default](./configs/renovate/default.json) | Default configuration for Renovate | `"extends": ["github>TimSchoenle/actions//configs/renovate/default"]` |
| [workflows](./configs/renovate/workflows.json) | Versioning rules for all custom Reusable Workflows defined in this repository | `"extends": ["github>TimSchoenle/actions//configs/renovate/workflows"]` |



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
