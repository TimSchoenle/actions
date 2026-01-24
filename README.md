# CI Repository

## 🤖 Keep Actions Up-to-Date

These actions use a specific versioning format (e.g. `actions-name-v1.0.0`) to support multiple actions in one repository.

To ensure **Renovate** can correctly detect new versions and auto-merge updates, simply extend our shared configuration in your `renovate.json`:

```json
{
  "extends": [
    "github>TimSchoenle/actions//configs/renovate/base"
  ]
}
```

## 🚀 Available Actions

Here is a list of all currently maintained actions in this repository:

### Bun

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Bun Setup-cached](./actions/bun/setup-cached) | Sets up Bun and manages dependency caching. | actions-bun-setup-cached-v1.1.3 | `uses: TimSchoenle/actions/actions/bun/setup-cached@actions-bun-setup-cached-v1.1.3` |

### Common

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Commit Changes](./actions/common/commit-changes) | Commits changes using the GitHub API to ensure verified bot commits. | actions-common-commit-changes-v1.1.1 | `uses: TimSchoenle/actions/actions/common/commit-changes@actions-common-commit-changes-v1.1.1` |
| [Common Modify YAML](./actions/common/modify-yaml) | A action to modify a value in a YAML file while strictly preserving comments and structure | actions-common-modify-yaml-v1.1.2 | `uses: TimSchoenle/actions/actions/common/modify-yaml@actions-common-modify-yaml-v1.1.2` |
| [Common Read YAML](./actions/common/read-yaml) | A action to read a value from a YAML file using dot notation | actions-common-read-yaml-v1.1.0 | `uses: TimSchoenle/actions/actions/common/read-yaml@actions-common-read-yaml-v1.1.0` |
| [Get App Git Identity](./actions/common/get-app-git-identity) | Resolves the git identity (username, email, user ID) for a GitHub App bot. | actions-common-get-app-git-identity-v1.1.0 | `uses: TimSchoenle/actions/actions/common/get-app-git-identity@actions-common-get-app-git-identity-v1.1.0` |
| [Setup App Git Identity](./actions/common/setup-app-git-identity) | Configures git with the identity of a GitHub App bot and outputs the bot details. | actions-common-setup-app-git-identity-v1.1.0 | `uses: TimSchoenle/actions/actions/common/setup-app-git-identity@actions-common-setup-app-git-identity-v1.1.0` |

### Helm

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Update Helm Chart Version](./actions/helm/update-chart-version) | Updates a Helm chart version, appVersion, and image tag, then creates a Pull Request. This action requires a bot account with access to the charts repo. Requires structure: Chart.yaml (version, appVersion) and values.yaml (image.tag). | actions-helm-update-chart-version-v1.4.3 | `uses: TimSchoenle/actions/actions/helm/update-chart-version@actions-helm-update-chart-version-v1.4.3` |

### Helper

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Verify Commit Authors](./actions/helper/verify-commit-authors) | Verifies that all commits in a PR are authored by a specific set of users and are signed. | actions-helper-verify-commit-authors-v1.1.2 | `uses: TimSchoenle/actions/actions/helper/verify-commit-authors@actions-helper-verify-commit-authors-v1.1.2` |



## 🔄 Reusable Workflows
### Common

| Workflow | Description | Version | Usage |
| --- | --- | --- | --- |
| [Common Test Workflow21345](./workflows/common/test2) | Reusable workflow for common-test2 | workflows-common-test2-v2.11.0 | `uses: TimSchoenle/actions/.github/workflows/common-test2.yaml@workflows-common-test2-v2.11.0` |

### Maintenance

| Workflow | Description | Version | Usage |
| --- | --- | --- | --- |
| [Auto Format](./workflows/maintenance/auto-bun-prettier) | Reusable workflow to auto-format code using Bun (Prettier) and commit changes. | workflows-maintenance-auto-bun-prettier-v1.1.7 | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-bun-prettier.yaml@workflows-maintenance-auto-bun-prettier-v1.1.7` |
| [Auto-Approve & Merge Timed PRs](./workflows/maintenance/timed-auto-pr-approve) | Reusable workflow that automatically verifies, approves, and merges Pull Requests that match a specific branch pattern and have been open for a configurable duration. It ensures all commits are signed and authored by trusted users. | workflows-maintenance-timed-auto-pr-approve-v1.2.7 | `uses: TimSchoenle/actions/.github/workflows/maintenance-timed-auto-pr-approve.yaml@workflows-maintenance-timed-auto-pr-approve-v1.2.7` |
| [Maintenance Auto-approve-renovate](./workflows/maintenance/auto-approve-renovate) | Reusable workflow to auto approve Renovate PRs, this is useful to auto merge Renovate PRs which have auto-merge enabled. | workflows-maintenance-auto-approve-renovate-v1.2.5 | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-approve-renovate.yaml@workflows-maintenance-auto-approve-renovate-v1.2.5` |

### Rust

| Workflow | Description | Version | Usage |
| --- | --- | --- | --- |
| [Rust Auto-format](./workflows/rust/auto-format) | Reusable workflow that runs cargo fmt and commits changes. | workflows-rust-auto-format-v1.1.1 | `uses: TimSchoenle/actions/.github/workflows/rust-auto-format.yaml@workflows-rust-auto-format-v1.1.1` |
| [Rust Cargo Check](./workflows/rust/cargo-check) | Reusable workflow that runs cargo check to verify Rust code compiles without errors. | workflows-rust-cargo-check-v1.1.3 | `uses: TimSchoenle/actions/.github/workflows/rust-cargo-check.yaml@workflows-rust-cargo-check-v1.1.3` |
| [Rust Clippy](./workflows/rust/clippy) | Reusable workflow that runs clippy to catch common mistakes and improve your Rust code. | workflows-rust-clippy-v1.1.1 | `uses: TimSchoenle/actions/.github/workflows/rust-clippy.yaml@workflows-rust-clippy-v1.1.1` |
| [Rust Coverage (Codecov)](./workflows/rust/coverage-codecov) | Reusable workflow that runs cargo llvm-cov to generate code coverage and uploads to Codecov. | workflows-rust-coverage-codecov-v1.0.1 | `uses: TimSchoenle/actions/.github/workflows/rust-coverage-codecov.yaml@workflows-rust-coverage-codecov-v1.0.1` |
| [Rust Test](./workflows/rust/test) | Reusable workflow that runs cargo nextest to verify Rust code passes tests. | workflows-rust-test-v1.0.1 | `uses: TimSchoenle/actions/.github/workflows/rust-test.yaml@workflows-rust-test-v1.0.1` |



## ⚙️ Shared Configurations

### GitHub Rulesets

To use, you need to download the rules and Import the ruleset.

| Config | Description |
| --- | --- |
| [Renovate Branches: Trusted Bots & Admins Only](./configs/github-rulesets/branch-renovate_only-allow-trusted-bots-and-admins.json) | Restricts access to Renovate branches, allowing only trusted bots (Renovate, Automatic Release Manager) and admins to manage them, while enforcing code quality and signature requirements. |
| [Default Branch: Default Protection Rules](./configs/github-rulesets/branch-default_default-rules.json) | Enforces standard protection rules on the default branch: requires PRs with 1 approval (squash only), signed commits, CodeQL scanning, and passing status checks. |
| [Release Please Branches: Trusted Bots Only](./configs/github-rulesets/branch-release-please_only-allow-trusted-bots.json) | Restricts access to release-please branches, allowing only trusted bots to create, update, or delete them, while enforcing code quality and signature requirements. |
| [Release Tags: Only Allow Automatic Release Manager Bot](./configs/github-rulesets/release-tags_only-allow-automatic-release-manager-bot.json) | Enforces that only the Automatic Release Manager bot can create, update, or delete release tags. |


### Renovate

| Config | Description | Usage |
| --- | --- | --- |
| [actions](./configs/renovate/actions.json) | Versioning rules for all custom Github Actions defined in this repository | `"extends": ["github>TimSchoenle/actions//configs/renovate/actions"]` |
| [base](./configs/renovate/base.json) | Base configuration to handle custom versioning for all resources in this repository. | `"extends": ["github>TimSchoenle/actions//configs/renovate/base"]` |
| [ci-automerge](./configs/renovate/ci-automerge.json) | Auto-merge rules for all none major Github Actions including custom actions defined in this repository. | `"extends": ["github>TimSchoenle/actions//configs/renovate/ci-automerge"]` |
| [default](./configs/renovate/default.json) | Default configuration for Renovate | `"extends": ["github>TimSchoenle/actions//configs/renovate/default"]` |
| [workflows](./configs/renovate/workflows.json) | Versioning rules for all custom Reusable Workflows defined in this repository | `"extends": ["github>TimSchoenle/actions//configs/renovate/workflows"]` |



## 📦 Development

### Prerequisites

- [Bun](https://bun.sh) (latest version)

### Creating a New Action
To create a new action, run the interactive CLI:

```bash
bun run create-action
```
This command will guide you through setting up the action structure, `action.yaml`, and initial workflow files.

### Removing an Action
To safely remove an action and its associated configuration:

```bash
bun run remove-action
```
This ensures all related files and configurations are properly cleaned up.

### Creating a New Workflow
To create a new reusable workflow, run:

```bash
bun run create-workflow
```
This will set up the workflow structure, `workflow.yaml`, `README.md`, and configs.

### Removing a Workflow
To remove a reusable workflow:

```bash
bun run remove-workflow
```

> [!NOTE]
> The documentation (this README) is automatically generated and updated via CI on every push and PR. You do not need to manually update it.
