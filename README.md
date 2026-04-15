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
| [Bun Setup-cached](./actions/bun/setup-cached) | Sets up Bun and manages dependency caching. | [actions-bun-setup-cached-v1.1.8](https://github.com/TimSchoenle/actions/releases/tag/actions-bun-setup-cached-v1.1.8) | `uses: TimSchoenle/actions/actions/bun/setup-cached@fba42f3b3c460cdeb05f7fe0e49ab949dc6c37a9 # tag=actions-bun-setup-cached-v1.1.8` |

### Common

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Close Pull Request](./actions/common/close-pull-request) | Closes a pull request | [actions-common-close-pull-request-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-close-pull-request-v1.1.0) | `uses: TimSchoenle/actions/actions/common/close-pull-request@d553418def5cd5ba91cf4997752b3e2053fec978 # tag=actions-common-close-pull-request-v1.1.0` |
| [Commit Changes](./actions/common/commit-changes) | Commits changes using the GitHub API to ensure verified bot commits. | [actions-common-commit-changes-v1.1.4](https://github.com/TimSchoenle/actions/releases/tag/actions-common-commit-changes-v1.1.4) | `uses: TimSchoenle/actions/actions/common/commit-changes@8f15b94f827ea2005c0e32cadc86bb50969633dd # tag=actions-common-commit-changes-v1.1.4` |
| [Common Modify YAML](./actions/common/modify-yaml) | A action to modify a value in a YAML file while strictly preserving comments and structure | [actions-common-modify-yaml-v1.2.12](https://github.com/TimSchoenle/actions/releases/tag/actions-common-modify-yaml-v1.2.12) | `uses: TimSchoenle/actions/actions/common/modify-yaml@56893ecb55ddc7dbfc82657abe3f32dd306fd5e6 # tag=actions-common-modify-yaml-v1.2.12` |
| [Common Read YAML](./actions/common/read-yaml) | A action to read a value from a YAML file using dot notation | [actions-common-read-yaml-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-read-yaml-v1.1.0) | `uses: TimSchoenle/actions/actions/common/read-yaml@8278a5b0b944ee55bcfa361b60373c803154e3d3 # tag=actions-common-read-yaml-v1.1.0` |
| [Create Branch](./actions/common/create-branch) | Creates or resets a git branch using GitHub API. | [actions-common-create-branch-v1.2.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-create-branch-v1.2.0) | `uses: TimSchoenle/actions/actions/common/create-branch@331de547737ea4a2b899287998f1ff90a912b7ba # tag=actions-common-create-branch-v1.2.0` |
| [Create Pull Request](./actions/common/create-pull-request) | Creates or updates a pull request using GitHub App authentication with optional branch reset. | [actions-common-create-pull-request-v1.0.5](https://github.com/TimSchoenle/actions/releases/tag/actions-common-create-pull-request-v1.0.5) | `uses: TimSchoenle/actions/actions/common/create-pull-request@d3ca86986d44968790a98960aa09f4e4ca2ce4e7 # tag=actions-common-create-pull-request-v1.0.5` |
| [Delete-Branch](./actions/common/delete-branch) | Deletes a branch from a repository. Fails gracefully if the branch does not exist. | [actions-common-delete-branch-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-delete-branch-v1.1.0) | `uses: TimSchoenle/actions/actions/common/delete-branch@8001f0d144c85586ba753315fb37a5c8237cfa99 # tag=actions-common-delete-branch-v1.1.0` |
| [Get App Git Identity](./actions/common/get-app-git-identity) | Resolves the git identity (username, email, user ID) for a GitHub App bot. | [actions-common-get-app-git-identity-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-get-app-git-identity-v1.1.0) | `uses: TimSchoenle/actions/actions/common/get-app-git-identity@26754381479003bd81b51fffecc97f1faa20a9bf # tag=actions-common-get-app-git-identity-v1.1.0` |
| [Setup App Git Identity](./actions/common/setup-app-git-identity) | Configures git with the identity of a GitHub App bot and outputs the bot details. | [actions-common-setup-app-git-identity-v1.1.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-setup-app-git-identity-v1.1.1) | `uses: TimSchoenle/actions/actions/common/setup-app-git-identity@0621f2582bc1cf04ff8359848ea3bca65fd06fcf # tag=actions-common-setup-app-git-identity-v1.1.1` |

### Helm

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Update Helm Chart Version](./actions/helm/update-chart-version) | Updates a Helm chart version, appVersion, and image tag, then creates a Pull Request. This action requires a bot account with access to the charts repo. Requires structure: Chart.yaml (version, appVersion) and values.yaml (image.tag). | [actions-helm-update-chart-version-v1.5.9](https://github.com/TimSchoenle/actions/releases/tag/actions-helm-update-chart-version-v1.5.9) | `uses: TimSchoenle/actions/actions/helm/update-chart-version@actions-helm-update-chart-version-v1.5.9 # tag=actions-helm-update-chart-version-v1.5.9` |

### Helper

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Helper Verify-branch-name](./actions/helper/verify-branch-name) | Verify the given name matches the pattern and also check if it is fork or not | [actions-helper-verify-branch-name-v1.1.1](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-verify-branch-name-v1.1.1) | `uses: TimSchoenle/actions/actions/helper/verify-branch-name@942adbf1569777c9a9ef84f002ffd3c11736ee37 # tag=actions-helper-verify-branch-name-v1.1.1` |
| [Resolve Branch](./actions/helper/resolve-base-branch) | Resolve the given base branch or return default branch. With optional existence check. | [actions-helper-resolve-base-branch-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-resolve-base-branch-v1.1.0) | `uses: TimSchoenle/actions/actions/helper/resolve-base-branch@1017e17f2dd642294627f53332e9bb84617e5faf # tag=actions-helper-resolve-base-branch-v1.1.0` |
| [Verify Commit Authors](./actions/helper/verify-commit-authors) | Verifies that all commits in a PR are authored by a specific set of users and are signed. | [actions-helper-verify-commit-authors-v1.1.15](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-verify-commit-authors-v1.1.15) | `uses: TimSchoenle/actions/actions/helper/verify-commit-authors@bccec5397481133fa065b9ddd39261f0c40e4b58 # tag=actions-helper-verify-commit-authors-v1.1.15` |

### Java-gradle

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Java-gradle Auto-spotless](./actions/java-gradle/auto-spotless) | Automatically apply spotless formatting and commit changes. | [actions-java-gradle-auto-spotless-v1.1.4](https://github.com/TimSchoenle/actions/releases/tag/actions-java-gradle-auto-spotless-v1.1.4) | `uses: TimSchoenle/actions/actions/java-gradle/auto-spotless@e765cff1a4b68452e074f186bb8cceb8e92afea3 # tag=actions-java-gradle-auto-spotless-v1.1.4` |
| [Java-Gradle default setup](./actions/java-gradle/setup-base-environment) | Setup Java and Gradle environment for building, with opinionated default settings | [actions-java-gradle-setup-base-environment-v1.2.3](https://github.com/TimSchoenle/actions/releases/tag/actions-java-gradle-setup-base-environment-v1.2.3) | `uses: TimSchoenle/actions/actions/java-gradle/setup-base-environment@2fddd81b2ff88d6cee86ab71d17091270ce314af # tag=actions-java-gradle-setup-base-environment-v1.2.3` |

### Maintenance

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Maintenance Auto-approve-pr](./actions/maintenance/auto-approve-pr) | Auto approve Pull Requests with the given user ids and branches. | [actions-maintenance-auto-approve-pr-v1.1.6](https://github.com/TimSchoenle/actions/releases/tag/actions-maintenance-auto-approve-pr-v1.1.6) | `uses: TimSchoenle/actions/actions/maintenance/auto-approve-pr@fb56d7ecddd57507e1a2dc09db7bd660bfaef4c7 # tag=actions-maintenance-auto-approve-pr-v1.1.6` |
| [Maintenance Ensure-actions-are-executed](./actions/maintenance/ensure-actions-are-executed) | Ensures selected checks completed successfully when they were started. | [actions-maintenance-ensure-actions-are-executed-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-maintenance-ensure-actions-are-executed-v1.1.0) | `uses: TimSchoenle/actions/actions/maintenance/ensure-actions-are-executed@4e453a788e2ca7144982e5fd43c4b987f6ba62ae # tag=actions-maintenance-ensure-actions-are-executed-v1.1.0` |

### Rust

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Rust Auto-format](./actions/rust/auto-format) | Action that runs cargo fmt and commits changes. | [actions-rust-auto-format-v1.1.1](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-auto-format-v1.1.1) | `uses: TimSchoenle/actions/actions/rust/auto-format@a8ecb4e918cbaa7adc2add02eb30a5eeccfe8f16 # tag=actions-rust-auto-format-v1.1.1` |
| [Rust Cargo-check](./actions/rust/cargo-check) | Action that runs cargo check to verify Rust code compiles without errors. | [actions-rust-cargo-check-v1.1.1](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-cargo-check-v1.1.1) | `uses: TimSchoenle/actions/actions/rust/cargo-check@02a8802b29657ed62cb2551a2a7a566a5cb8211d # tag=actions-rust-cargo-check-v1.1.1` |
| [Rust Clippy](./actions/rust/clippy) | Action that runs clippy to catch common mistakes and improve your Rust code. | [actions-rust-clippy-v1.1.1](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-clippy-v1.1.1) | `uses: TimSchoenle/actions/actions/rust/clippy@bcab607db683736d14781974e312d58445270c5c # tag=actions-rust-clippy-v1.1.1` |
| [Rust Coverage (Codecov)](./actions/rust/coverage-codecov) | Action that runs cargo llvm-cov to generate code coverage and uploads to Codecov. | [actions-rust-coverage-codecov-v1.1.7](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-coverage-codecov-v1.1.7) | `uses: TimSchoenle/actions/actions/rust/coverage-codecov@8280ebf8a35028679699bc9f9471c547f6656601 # tag=actions-rust-coverage-codecov-v1.1.7` |
| [Rust Test](./actions/rust/test) | Action that runs cargo nextest to verify Rust code passes tests. | [actions-rust-test-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-test-v1.1.0) | `uses: TimSchoenle/actions/actions/rust/test@0db455a705ea67cf5c0844b1b180ed6b653e1c8d # tag=actions-rust-test-v1.1.0` |

### Test

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Setup E2E Test](./actions/test/setup-e2e) | Sets up the environment for E2E testing: generates token, checks out test repo, and checks out actions code. | [actions-test-setup-e2e-v1.2.1](https://github.com/TimSchoenle/actions/releases/tag/actions-test-setup-e2e-v1.2.1) | `uses: TimSchoenle/actions/actions/test/setup-e2e@582a7bd61635e07a349a25622e47b2e9f8465d3c # tag=actions-test-setup-e2e-v1.2.1` |



## 🔄 Reusable Workflows
### Maintenance

| Workflow | Description | Version | Usage |
| --- | --- | --- | --- |
| [Auto Format](./workflows/maintenance/auto-bun-prettier) | Reusable workflow to auto-format code using Bun (Prettier) and commit changes. | [workflows-maintenance-auto-bun-prettier-v1.1.13](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-bun-prettier-v1.1.13) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-bun-prettier.yaml@workflows-maintenance-auto-bun-prettier-v1.1.13 # tag=workflows-maintenance-auto-bun-prettier-v1.1.13` |
| [Auto-Approve & Merge Timed PRs](./workflows/maintenance/timed-auto-pr-approve) | Reusable workflow that automatically verifies, approves, and merges Pull Requests that match a specific branch pattern and have been open for a configurable duration. It ensures all commits are signed and authored by trusted users. | [workflows-maintenance-timed-auto-pr-approve-v1.2.13](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-timed-auto-pr-approve-v1.2.13) | `uses: TimSchoenle/actions/.github/workflows/maintenance-timed-auto-pr-approve.yaml@89315ca599e5a4a03e37fd8741839b4c05d9f6bc # tag=workflows-maintenance-timed-auto-pr-approve-v1.2.13` |
| [Maintenance Auto-approve-renovate](./workflows/maintenance/auto-approve-renovate) | Reusable workflow to auto approve Renovate PRs, this is useful to auto merge Renovate PRs which have auto-merge enabled. | [workflows-maintenance-auto-approve-renovate-v1.4.2](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-approve-renovate-v1.4.2) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-approve-renovate.yaml@80254723bf17772baa07d3a390013c9c0afc90f8 # tag=workflows-maintenance-auto-approve-renovate-v1.4.2` |
| [Maintenance Auto-rebase](./workflows/maintenance/auto-rebase) | Automatically rebases open PRs with a given label. | [workflows-maintenance-auto-rebase-v1.1.4](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-rebase-v1.1.4) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-rebase.yaml@634ae2d73de248f325149c33d40af6da3fe66ec9 # tag=workflows-maintenance-auto-rebase-v1.1.4` |
| [Maintenance Wipe-cache](./workflows/maintenance/wipe-cache) | Workflow to wipe all cache entries for the given branch. | [workflows-maintenance-wipe-cache-v1.1.6](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-wipe-cache-v1.1.6) | `uses: TimSchoenle/actions/.github/workflows/maintenance-wipe-cache.yaml@workflows-maintenance-wipe-cache-v1.1.6 # tag=workflows-maintenance-wipe-cache-v1.1.6` |



## ⚙️ Shared Configurations

### GitHub Rulesets

To use, you need to download the rules and Import the ruleset.

| Config | Description |
| --- | --- |
| [Release Tags: Only Allow Automatic Release Manager Bot](./configs/github-rulesets/release-tags_only-allow-automatic-release-manager-bot.json) | Enforces that only the Automatic Release Manager bot can create, update, or delete release tags. |
| [Default Branch: Default Protection Rules](./configs/github-rulesets/branch-default_default-rules.json) | Enforces standard protection rules on the default branch: requires PRs with 1 approval (squash only), signed commits, CodeQL scanning, and passing status checks. |
| [Release Please Branches: Trusted Bots Only](./configs/github-rulesets/branch-release-please_only-allow-trusted-bots.json) | Restricts access to release-please branches, allowing only trusted bots to create, update, or delete them, while enforcing code quality and signature requirements. |
| [Renovate Branches: Trusted Bots & Admins Only](./configs/github-rulesets/branch-renovate_only-allow-trusted-bots-and-admins.json) | Restricts access to Renovate branches, allowing only trusted bots (Renovate, Automatic Release Manager) and admins to manage them, while enforcing code quality and signature requirements. |


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
