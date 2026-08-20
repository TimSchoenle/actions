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
| [Bun Setup-cached](./actions/bun/setup-cached) | Sets up Bun and manages dependency caching. | [actions-bun-setup-cached-v1.1.10](https://github.com/TimSchoenle/actions/releases/tag/actions-bun-setup-cached-v1.1.10) | `uses: TimSchoenle/actions/actions/bun/setup-cached@cbdcf6fd08b46059064bc9c91efa6b610a9ee7db # tag=actions-bun-setup-cached-v1.1.10` |

### Common

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Close Pull Request](./actions/common/close-pull-request) | Closes a pull request | [actions-common-close-pull-request-v1.3.2](https://github.com/TimSchoenle/actions/releases/tag/actions-common-close-pull-request-v1.3.2) | `uses: TimSchoenle/actions/actions/common/close-pull-request@c36446abd6998a728ff87b5b73c2718e12af6983 # tag=actions-common-close-pull-request-v1.3.2` |
| [Commit Changes](./actions/common/commit-changes) | Commits changes using the GitHub API to ensure verified bot commits. | [actions-common-commit-changes-v1.3.2](https://github.com/TimSchoenle/actions/releases/tag/actions-common-commit-changes-v1.3.2) | `uses: TimSchoenle/actions/actions/common/commit-changes@76719ba61e9b9cf1ffafdc3cb895308055a7f3bd # tag=actions-common-commit-changes-v1.3.2` |
| [Common Modify YAML](./actions/common/modify-yaml) | A action to modify a value in a YAML file while strictly preserving comments and structure | [actions-common-modify-yaml-v1.4.3](https://github.com/TimSchoenle/actions/releases/tag/actions-common-modify-yaml-v1.4.3) | `uses: TimSchoenle/actions/actions/common/modify-yaml@704c71fc1b0cac28ef7c10357c284a9b0f133e22 # tag=actions-common-modify-yaml-v1.4.3` |
| [Common Read YAML](./actions/common/read-yaml) | A action to read a value from a YAML file using dot notation | [actions-common-read-yaml-v1.2.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-read-yaml-v1.2.1) | `uses: TimSchoenle/actions/actions/common/read-yaml@7efaecb5aae4f1b50f567b357cd91cfa2a1191ac # tag=actions-common-read-yaml-v1.2.1` |
| [Create Branch](./actions/common/create-branch) | Creates or resets a git branch using GitHub API. | [actions-common-create-branch-v1.4.2](https://github.com/TimSchoenle/actions/releases/tag/actions-common-create-branch-v1.4.2) | `uses: TimSchoenle/actions/actions/common/create-branch@7c48fd3e0108a94d9b2a83f87c455d6991d65347 # tag=actions-common-create-branch-v1.4.2` |
| [Create Pull Request](./actions/common/create-pull-request) | Creates or updates a pull request using GitHub App authentication with optional branch reset. | [actions-common-create-pull-request-v1.0.12](https://github.com/TimSchoenle/actions/releases/tag/actions-common-create-pull-request-v1.0.12) | `uses: TimSchoenle/actions/actions/common/create-pull-request@5dc57f8787b2e2572fc2419c8446b7cdd33c37a4 # tag=actions-common-create-pull-request-v1.0.12` |
| [Delete-Branch](./actions/common/delete-branch) | Deletes a branch from a repository. Fails gracefully if the branch does not exist. | [actions-common-delete-branch-v1.3.2](https://github.com/TimSchoenle/actions/releases/tag/actions-common-delete-branch-v1.3.2) | `uses: TimSchoenle/actions/actions/common/delete-branch@8c880e3ff510c01a8615bff10c989657797d7759 # tag=actions-common-delete-branch-v1.3.2` |
| [Get App Git Identity](./actions/common/get-app-git-identity) | Resolves the git identity (username, email, user ID) for a GitHub App bot. | [actions-common-get-app-git-identity-v1.3.2](https://github.com/TimSchoenle/actions/releases/tag/actions-common-get-app-git-identity-v1.3.2) | `uses: TimSchoenle/actions/actions/common/get-app-git-identity@975ae3a2616f52d8752f801a7f345e90c7c4f6e7 # tag=actions-common-get-app-git-identity-v1.3.2` |
| [Render Template](./actions/common/render-template) | A action to render a Handlebars template file to an output file from a JSON map of variables, deterministically | [actions-common-render-template-v1.1.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-render-template-v1.1.1) | `uses: TimSchoenle/actions/actions/common/render-template@3b7d152374ee63e720e7c16bed8b088b40554911 # tag=actions-common-render-template-v1.1.1` |
| [Render Template And Commit](./actions/common/render-template-and-commit) | Renders a Handlebars template to a file and commits the result as a verified bot commit, skipping the commit when the render changed nothing. | [actions-common-render-template-and-commit-v1.1.3](https://github.com/TimSchoenle/actions/releases/tag/actions-common-render-template-and-commit-v1.1.3) | `uses: TimSchoenle/actions/actions/common/render-template-and-commit@15d83f02081c9dc8a844646199c63792dcccdfa8 # tag=actions-common-render-template-and-commit-v1.1.3` |
| [Setup App Git Identity](./actions/common/setup-app-git-identity) | Configures git with the identity of a GitHub App bot and outputs the bot details. | [actions-common-setup-app-git-identity-v1.3.3](https://github.com/TimSchoenle/actions/releases/tag/actions-common-setup-app-git-identity-v1.3.3) | `uses: TimSchoenle/actions/actions/common/setup-app-git-identity@actions-common-setup-app-git-identity-v1.3.3 # tag=actions-common-setup-app-git-identity-v1.3.3` |

### Helm

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Apply Helm Chart Updates](./actions/helm/apply-chart-updates) | Applies a set of templated image updates to a Helm chart's values.yaml and bumps Chart.yaml, preserving comments and structure. Every image carries its own version and digest. | [actions-helm-apply-chart-updates-v1.2.1](https://github.com/TimSchoenle/actions/releases/tag/actions-helm-apply-chart-updates-v1.2.1) | `uses: TimSchoenle/actions/actions/helm/apply-chart-updates@64ea1ec370145ec92148b80717c12033b82375cd # tag=actions-helm-apply-chart-updates-v1.2.1` |
| [Update Helm Chart Version](./actions/helm/update-chart-version) | Updates a Helm chart's image tags, version and appVersion, then opens a Pull Request. Every image carries its own version and digest, so one call can move a chart with many services. This action requires a bot account with access to the charts repo. | [actions-helm-update-chart-version-v1.6.3](https://github.com/TimSchoenle/actions/releases/tag/actions-helm-update-chart-version-v1.6.3) | `uses: TimSchoenle/actions/actions/helm/update-chart-version@3b83076da17618c3221049eb1e671f20e8403694 # tag=actions-helm-update-chart-version-v1.6.3` |

### Helper

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Helper Verify-branch-name](./actions/helper/verify-branch-name) | Verify the head branch of a pull request matches a pattern and check whether it comes from a fork | [actions-helper-verify-branch-name-v1.3.1](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-verify-branch-name-v1.3.1) | `uses: TimSchoenle/actions/actions/helper/verify-branch-name@b6400c704cdf2503e09d58ee69d93af7967a76c8 # tag=actions-helper-verify-branch-name-v1.3.1` |
| [Resolve Branch](./actions/helper/resolve-base-branch) | Resolve the given base branch or return default branch. With optional existence check. | [actions-helper-resolve-base-branch-v1.3.2](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-resolve-base-branch-v1.3.2) | `uses: TimSchoenle/actions/actions/helper/resolve-base-branch@45e613e1449fb05c672e2817d48e161d35f15704 # tag=actions-helper-resolve-base-branch-v1.3.2` |
| [Verify Commit Authors](./actions/helper/verify-commit-authors) | Verifies that all commits in a PR are authored by a specific set of users and are signed. | [actions-helper-verify-commit-authors-v1.3.2](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-verify-commit-authors-v1.3.2) | `uses: TimSchoenle/actions/actions/helper/verify-commit-authors@7f0fe78248481f8d61f8a683bcd86b783b1251a0 # tag=actions-helper-verify-commit-authors-v1.3.2` |

### Java-gradle

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Java-gradle Auto-spotless](./actions/java-gradle/auto-spotless) | Automatically apply spotless formatting and commit changes. | [actions-java-gradle-auto-spotless-v1.1.16](https://github.com/TimSchoenle/actions/releases/tag/actions-java-gradle-auto-spotless-v1.1.16) | `uses: TimSchoenle/actions/actions/java-gradle/auto-spotless@84fb33691fb190da99c4a84c4bf56737f12bb972 # tag=actions-java-gradle-auto-spotless-v1.1.16` |
| [Java-Gradle default setup](./actions/java-gradle/setup-base-environment) | Setup Java and Gradle environment for building, with opinionated default settings | [actions-java-gradle-setup-base-environment-v1.2.9](https://github.com/TimSchoenle/actions/releases/tag/actions-java-gradle-setup-base-environment-v1.2.9) | `uses: TimSchoenle/actions/actions/java-gradle/setup-base-environment@e9ac4a44bc0c474dc91d1e0e69d61d8bf8aa8f46 # tag=actions-java-gradle-setup-base-environment-v1.2.9` |

### Maintenance

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Maintenance Auto-approve-pr](./actions/maintenance/auto-approve-pr) | Auto approve Pull Requests with the given user ids and branches. | [actions-maintenance-auto-approve-pr-v1.3.2](https://github.com/TimSchoenle/actions/releases/tag/actions-maintenance-auto-approve-pr-v1.3.2) | `uses: TimSchoenle/actions/actions/maintenance/auto-approve-pr@abf371d5c6afa750195ca35b42161c472b9a6f6f # tag=actions-maintenance-auto-approve-pr-v1.3.2` |
| [Maintenance Ensure-actions-are-executed](./actions/maintenance/ensure-actions-are-executed) | Ensures selected checks completed successfully when they were started. | [actions-maintenance-ensure-actions-are-executed-v1.3.2](https://github.com/TimSchoenle/actions/releases/tag/actions-maintenance-ensure-actions-are-executed-v1.3.2) | `uses: TimSchoenle/actions/actions/maintenance/ensure-actions-are-executed@c837042661a52c9e413ec0d6eb13a013152e98b3 # tag=actions-maintenance-ensure-actions-are-executed-v1.3.2` |

### Rust

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Rust Auto-format](./actions/rust/auto-format) | Action that runs cargo fmt and commits changes. | [actions-rust-auto-format-v1.1.11](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-auto-format-v1.1.11) | `uses: TimSchoenle/actions/actions/rust/auto-format@bde85524c019be605fa345f4203c4a37b68f1336 # tag=actions-rust-auto-format-v1.1.11` |
| [Rust Cargo-check](./actions/rust/cargo-check) | Action that runs cargo check to verify Rust code compiles without errors. | [actions-rust-cargo-check-v1.1.5](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-cargo-check-v1.1.5) | `uses: TimSchoenle/actions/actions/rust/cargo-check@5798c7bd8d1d98a0c7360114e91a0ac3b86bf145 # tag=actions-rust-cargo-check-v1.1.5` |
| [Rust Clippy](./actions/rust/clippy) | Action that runs clippy to catch common mistakes and improve your Rust code. | [actions-rust-clippy-v1.1.9](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-clippy-v1.1.9) | `uses: TimSchoenle/actions/actions/rust/clippy@dcfb46a6a17ad8565db74057ce60278953056ad5 # tag=actions-rust-clippy-v1.1.9` |
| [Rust Config Contract](./actions/rust/config-contract) | Action that checks a terrace-config contract, its Dockerfile LABEL block and a built image against the configuration types they claim to describe. | [actions-rust-config-contract-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-config-contract-v1.1.0) | `uses: TimSchoenle/actions/actions/rust/config-contract@99c83581b3486a8a9f28e43226b8f02025fcdf9a # tag=actions-rust-config-contract-v1.1.0` |
| [Rust Coverage (Codecov)](./actions/rust/coverage-codecov) | Action that runs cargo llvm-cov to generate code coverage and uploads to Codecov. | [actions-rust-coverage-codecov-v1.1.39](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-coverage-codecov-v1.1.39) | `uses: TimSchoenle/actions/actions/rust/coverage-codecov@207f2cffd44a2c761e4cffe05133190db5f70577 # tag=actions-rust-coverage-codecov-v1.1.39` |
| [Rust Test](./actions/rust/test) | Action that runs cargo nextest to verify Rust code passes tests. | [actions-rust-test-v1.1.1](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-test-v1.1.1) | `uses: TimSchoenle/actions/actions/rust/test@c6844b562767b6e68fff4d39bdf9eced6e29b318 # tag=actions-rust-test-v1.1.1` |

### Test

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Setup E2E Test](./actions/test/setup-e2e) | Sets up the environment for E2E testing: generates token, checks out test repo, and checks out actions code. | [actions-test-setup-e2e-v1.2.2](https://github.com/TimSchoenle/actions/releases/tag/actions-test-setup-e2e-v1.2.2) | `uses: TimSchoenle/actions/actions/test/setup-e2e@9aabf0be4b0008aa5bdc479b556851c3a5c54d93 # tag=actions-test-setup-e2e-v1.2.2` |



## 🔄 Reusable Workflows
### Maintenance

| Workflow | Description | Version | Usage |
| --- | --- | --- | --- |
| [Auto Format](./workflows/maintenance/auto-bun-prettier) | Reusable workflow to auto-format code by running a "bun run" script and commit changes. | [workflows-maintenance-auto-bun-prettier-v1.1.27](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-bun-prettier-v1.1.27) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-bun-prettier.yaml@08f9d3edd630b7e9a6624b16a26bdfbb26f65fce # tag=workflows-maintenance-auto-bun-prettier-v1.1.27` |
| [Auto-Approve & Merge Timed PRs](./workflows/maintenance/timed-auto-pr-approve) | Reusable workflow that automatically verifies, approves, and merges Pull Requests that match a specific branch pattern and have been open for a configurable duration. It ensures all commits are signed and authored by trusted users. | [workflows-maintenance-timed-auto-pr-approve-v1.2.32](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-timed-auto-pr-approve-v1.2.32) | `uses: TimSchoenle/actions/.github/workflows/maintenance-timed-auto-pr-approve.yaml@e6fecc9f09559eced99c451f433a5bbe7027193e # tag=workflows-maintenance-timed-auto-pr-approve-v1.2.32` |
| [Maintenance Auto-approve-renovate](./workflows/maintenance/auto-approve-renovate) | Reusable workflow to auto approve Renovate PRs, this is useful to auto merge Renovate PRs which have auto-merge enabled. | [workflows-maintenance-auto-approve-renovate-v1.4.21](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-approve-renovate-v1.4.21) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-approve-renovate.yaml@f01853c3e1b3eb332b02ed77f9aaaa862687792e # tag=workflows-maintenance-auto-approve-renovate-v1.4.21` |
| [Maintenance Auto-rebase](./workflows/maintenance/auto-rebase) | Automatically rebases open PRs with a given label. | [workflows-maintenance-auto-rebase-v1.1.6](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-rebase-v1.1.6) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-rebase.yaml@43af44486f5d94a5438695ee2918d276852f9db5 # tag=workflows-maintenance-auto-rebase-v1.1.6` |
| [Maintenance Wipe-cache](./workflows/maintenance/wipe-cache) | Workflow to wipe all cache entries for the given branch. | [workflows-maintenance-wipe-cache-v1.1.11](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-wipe-cache-v1.1.11) | `uses: TimSchoenle/actions/.github/workflows/maintenance-wipe-cache.yaml@7103e418c5c928a5c0ba684e72c2f062bed96505 # tag=workflows-maintenance-wipe-cache-v1.1.11` |



## ⚙️ Shared Configurations

### GitHub Rulesets

To use, you need to download the rules and Import the ruleset.

| Config | Description |
| --- | --- |
| [Default Branch: Default Protection Rules](./configs/github-rulesets/branch-default_default-rules.json) | Enforces standard protection rules on the default branch: requires PRs with 1 approval (squash only), signed commits, CodeQL scanning, and passing status checks. |
| [Release Please Branches: Trusted Bots Only](./configs/github-rulesets/branch-release-please_only-allow-trusted-bots.json) | Restricts access to release-please branches, allowing only trusted bots to create, update, or delete them, while enforcing code quality and signature requirements. |
| [Release Tags: Only Allow Automatic Release Manager Bot](./configs/github-rulesets/release-tags_only-allow-automatic-release-manager-bot.json) | Enforces that only the Automatic Release Manager bot can create, update, or delete release tags. |
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
