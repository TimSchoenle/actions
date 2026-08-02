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
| [Close Pull Request](./actions/common/close-pull-request) | Closes a pull request | [actions-common-close-pull-request-v1.2.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-close-pull-request-v1.2.1) | `uses: TimSchoenle/actions/actions/common/close-pull-request@5555e4c158b8325fa11fd1a2b39258347a886517 # tag=actions-common-close-pull-request-v1.2.1` |
| [Commit Changes](./actions/common/commit-changes) | Commits changes using the GitHub API to ensure verified bot commits. | [actions-common-commit-changes-v1.2.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-commit-changes-v1.2.1) | `uses: TimSchoenle/actions/actions/common/commit-changes@990f592db0d2b0ebc3842d6bbf636a9a4638b070 # tag=actions-common-commit-changes-v1.2.1` |
| [Common Modify YAML](./actions/common/modify-yaml) | A action to modify a value in a YAML file while strictly preserving comments and structure | [actions-common-modify-yaml-v1.3.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-modify-yaml-v1.3.1) | `uses: TimSchoenle/actions/actions/common/modify-yaml@03a4e1a60d5afd30b9404ab6a17349a71688ec6c # tag=actions-common-modify-yaml-v1.3.1` |
| [Common Read YAML](./actions/common/read-yaml) | A action to read a value from a YAML file using dot notation | [actions-common-read-yaml-v1.1.2](https://github.com/TimSchoenle/actions/releases/tag/actions-common-read-yaml-v1.1.2) | `uses: TimSchoenle/actions/actions/common/read-yaml@7c23161e06ceb38f27b43d037ba1ac118cdb3aa4 # tag=actions-common-read-yaml-v1.1.2` |
| [Create Branch](./actions/common/create-branch) | Creates or resets a git branch using GitHub API. | [actions-common-create-branch-v1.3.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-create-branch-v1.3.1) | `uses: TimSchoenle/actions/actions/common/create-branch@b2d91d475a1436da4c9b2a2835897413913ef6d7 # tag=actions-common-create-branch-v1.3.1` |
| [Create Pull Request](./actions/common/create-pull-request) | Creates or updates a pull request using GitHub App authentication with optional branch reset. | [actions-common-create-pull-request-v1.0.9](https://github.com/TimSchoenle/actions/releases/tag/actions-common-create-pull-request-v1.0.9) | `uses: TimSchoenle/actions/actions/common/create-pull-request@0bb04fa0f8a8f4ebbe1668f7c28f230c55fd5d3d # tag=actions-common-create-pull-request-v1.0.9` |
| [Delete-Branch](./actions/common/delete-branch) | Deletes a branch from a repository. Fails gracefully if the branch does not exist. | [actions-common-delete-branch-v1.2.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-delete-branch-v1.2.1) | `uses: TimSchoenle/actions/actions/common/delete-branch@ed9d34e3034a8631d4bf462baa093eb20bb4b7d3 # tag=actions-common-delete-branch-v1.2.1` |
| [Get App Git Identity](./actions/common/get-app-git-identity) | Resolves the git identity (username, email, user ID) for a GitHub App bot. | [actions-common-get-app-git-identity-v1.2.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-get-app-git-identity-v1.2.1) | `uses: TimSchoenle/actions/actions/common/get-app-git-identity@ec69d3449f11a8291934cf11a9ef57f72a423376 # tag=actions-common-get-app-git-identity-v1.2.1` |
| [Render Template](./actions/common/render-template) | A action to render a Handlebars template file to an output file from a JSON map of variables, deterministically | [actions-common-render-template-v1.0.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-render-template-v1.0.1) | `uses: TimSchoenle/actions/actions/common/render-template@252ad581f80b7a48fe5c26a6b7e7bad317767183 # tag=actions-common-render-template-v1.0.1` |
| [Render Template And Commit](./actions/common/render-template-and-commit) | Renders a Handlebars template to a file and commits the result as a verified bot commit, skipping the commit when the render changed nothing. | [actions-common-render-template-and-commit-v1.1.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-render-template-and-commit-v1.1.1) | `uses: TimSchoenle/actions/actions/common/render-template-and-commit@7036b316c73d401f531468d09f391a76a4ab4b3f # tag=actions-common-render-template-and-commit-v1.1.1` |
| [Setup App Git Identity](./actions/common/setup-app-git-identity) | Configures git with the identity of a GitHub App bot and outputs the bot details. | [actions-common-setup-app-git-identity-v1.2.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-setup-app-git-identity-v1.2.1) | `uses: TimSchoenle/actions/actions/common/setup-app-git-identity@462e82960571edefd2dd832f1bea119f8acef97b # tag=actions-common-setup-app-git-identity-v1.2.1` |

### Helm

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Update Helm Chart Version](./actions/helm/update-chart-version) | Updates a Helm chart version, appVersion, and image tag, then creates a Pull Request. This action requires a bot account with access to the charts repo. Requires structure: Chart.yaml (version, appVersion) and values.yaml (image.tag). | [actions-helm-update-chart-version-v1.5.23](https://github.com/TimSchoenle/actions/releases/tag/actions-helm-update-chart-version-v1.5.23) | `uses: TimSchoenle/actions/actions/helm/update-chart-version@0ada9fd480cb7ecb07078bac8a77702caa1d6b99 # tag=actions-helm-update-chart-version-v1.5.23` |

### Helper

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Helper Verify-branch-name](./actions/helper/verify-branch-name) | Verify the head branch of a pull request matches a pattern and check whether it comes from a fork | [actions-helper-verify-branch-name-v1.2.1](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-verify-branch-name-v1.2.1) | `uses: TimSchoenle/actions/actions/helper/verify-branch-name@0d02dddf74bb1bcf66302bb8d3a73ab09e822d6d # tag=actions-helper-verify-branch-name-v1.2.1` |
| [Resolve Branch](./actions/helper/resolve-base-branch) | Resolve the given base branch or return default branch. With optional existence check. | [actions-helper-resolve-base-branch-v1.2.1](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-resolve-base-branch-v1.2.1) | `uses: TimSchoenle/actions/actions/helper/resolve-base-branch@a99f2d5e7d0e687c22e5499917b1adb3d4a76c7f # tag=actions-helper-resolve-base-branch-v1.2.1` |
| [Verify Commit Authors](./actions/helper/verify-commit-authors) | Verifies that all commits in a PR are authored by a specific set of users and are signed. | [actions-helper-verify-commit-authors-v1.2.1](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-verify-commit-authors-v1.2.1) | `uses: TimSchoenle/actions/actions/helper/verify-commit-authors@40430fefc0c31e4a2b62f5341871ff202c63b5e6 # tag=actions-helper-verify-commit-authors-v1.2.1` |

### Java-gradle

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Java-gradle Auto-spotless](./actions/java-gradle/auto-spotless) | Automatically apply spotless formatting and commit changes. | [actions-java-gradle-auto-spotless-v1.1.13](https://github.com/TimSchoenle/actions/releases/tag/actions-java-gradle-auto-spotless-v1.1.13) | `uses: TimSchoenle/actions/actions/java-gradle/auto-spotless@actions-java-gradle-auto-spotless-v1.1.13 # tag=actions-java-gradle-auto-spotless-v1.1.13` |
| [Java-Gradle default setup](./actions/java-gradle/setup-base-environment) | Setup Java and Gradle environment for building, with opinionated default settings | [actions-java-gradle-setup-base-environment-v1.2.8](https://github.com/TimSchoenle/actions/releases/tag/actions-java-gradle-setup-base-environment-v1.2.8) | `uses: TimSchoenle/actions/actions/java-gradle/setup-base-environment@478ac4b0c6d4df979618f856207f3f1fdba5b67e # tag=actions-java-gradle-setup-base-environment-v1.2.8` |

### Maintenance

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Maintenance Auto-approve-pr](./actions/maintenance/auto-approve-pr) | Auto approve Pull Requests with the given user ids and branches. | [actions-maintenance-auto-approve-pr-v1.2.1](https://github.com/TimSchoenle/actions/releases/tag/actions-maintenance-auto-approve-pr-v1.2.1) | `uses: TimSchoenle/actions/actions/maintenance/auto-approve-pr@6c7b451180b1d4753a6a6565ddc2bfe92da4b913 # tag=actions-maintenance-auto-approve-pr-v1.2.1` |
| [Maintenance Ensure-actions-are-executed](./actions/maintenance/ensure-actions-are-executed) | Ensures selected checks completed successfully when they were started. | [actions-maintenance-ensure-actions-are-executed-v1.2.1](https://github.com/TimSchoenle/actions/releases/tag/actions-maintenance-ensure-actions-are-executed-v1.2.1) | `uses: TimSchoenle/actions/actions/maintenance/ensure-actions-are-executed@1e532b5f6c9e317c017879a4a8add4522c12ee71 # tag=actions-maintenance-ensure-actions-are-executed-v1.2.1` |

### Rust

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Rust Auto-format](./actions/rust/auto-format) | Action that runs cargo fmt and commits changes. | [actions-rust-auto-format-v1.1.8](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-auto-format-v1.1.8) | `uses: TimSchoenle/actions/actions/rust/auto-format@99164fcd01b2f6b4ef304f9897a80b8ef08fb5af # tag=actions-rust-auto-format-v1.1.8` |
| [Rust Cargo-check](./actions/rust/cargo-check) | Action that runs cargo check to verify Rust code compiles without errors. | [actions-rust-cargo-check-v1.1.5](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-cargo-check-v1.1.5) | `uses: TimSchoenle/actions/actions/rust/cargo-check@5798c7bd8d1d98a0c7360114e91a0ac3b86bf145 # tag=actions-rust-cargo-check-v1.1.5` |
| [Rust Clippy](./actions/rust/clippy) | Action that runs clippy to catch common mistakes and improve your Rust code. | [actions-rust-clippy-v1.1.9](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-clippy-v1.1.9) | `uses: TimSchoenle/actions/actions/rust/clippy@dcfb46a6a17ad8565db74057ce60278953056ad5 # tag=actions-rust-clippy-v1.1.9` |
| [Rust Coverage (Codecov)](./actions/rust/coverage-codecov) | Action that runs cargo llvm-cov to generate code coverage and uploads to Codecov. | [actions-rust-coverage-codecov-v1.1.33](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-coverage-codecov-v1.1.33) | `uses: TimSchoenle/actions/actions/rust/coverage-codecov@e85fc85e09768aec09fb8b6fb16e01ee68b87a1b # tag=actions-rust-coverage-codecov-v1.1.33` |
| [Rust Test](./actions/rust/test) | Action that runs cargo nextest to verify Rust code passes tests. | [actions-rust-test-v1.1.1](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-test-v1.1.1) | `uses: TimSchoenle/actions/actions/rust/test@c6844b562767b6e68fff4d39bdf9eced6e29b318 # tag=actions-rust-test-v1.1.1` |

### Test

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Setup E2E Test](./actions/test/setup-e2e) | Sets up the environment for E2E testing: generates token, checks out test repo, and checks out actions code. | [actions-test-setup-e2e-v1.2.2](https://github.com/TimSchoenle/actions/releases/tag/actions-test-setup-e2e-v1.2.2) | `uses: TimSchoenle/actions/actions/test/setup-e2e@9aabf0be4b0008aa5bdc479b556851c3a5c54d93 # tag=actions-test-setup-e2e-v1.2.2` |



## 🔄 Reusable Workflows
### Maintenance

| Workflow | Description | Version | Usage |
| --- | --- | --- | --- |
| [Auto Format](./workflows/maintenance/auto-bun-prettier) | Reusable workflow to auto-format code using Bun (Prettier) and commit changes. | [workflows-maintenance-auto-bun-prettier-v1.1.24](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-bun-prettier-v1.1.24) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-bun-prettier.yaml@workflows-maintenance-auto-bun-prettier-v1.1.24 # tag=workflows-maintenance-auto-bun-prettier-v1.1.24` |
| [Auto-Approve & Merge Timed PRs](./workflows/maintenance/timed-auto-pr-approve) | Reusable workflow that automatically verifies, approves, and merges Pull Requests that match a specific branch pattern and have been open for a configurable duration. It ensures all commits are signed and authored by trusted users. | [workflows-maintenance-timed-auto-pr-approve-v1.2.27](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-timed-auto-pr-approve-v1.2.27) | `uses: TimSchoenle/actions/.github/workflows/maintenance-timed-auto-pr-approve.yaml@ef7f690e384fd488287e45021cf3dce5dfa2576d # tag=workflows-maintenance-timed-auto-pr-approve-v1.2.27` |
| [Maintenance Auto-approve-renovate](./workflows/maintenance/auto-approve-renovate) | Reusable workflow to auto approve Renovate PRs, this is useful to auto merge Renovate PRs which have auto-merge enabled. | [workflows-maintenance-auto-approve-renovate-v1.4.16](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-approve-renovate-v1.4.16) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-approve-renovate.yaml@cf943de5f57977a39da87445cc9110f31cb8032d # tag=workflows-maintenance-auto-approve-renovate-v1.4.16` |
| [Maintenance Auto-rebase](./workflows/maintenance/auto-rebase) | Automatically rebases open PRs with a given label. | [workflows-maintenance-auto-rebase-v1.1.6](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-rebase-v1.1.6) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-rebase.yaml@43af44486f5d94a5438695ee2918d276852f9db5 # tag=workflows-maintenance-auto-rebase-v1.1.6` |
| [Maintenance Wipe-cache](./workflows/maintenance/wipe-cache) | Workflow to wipe all cache entries for the given branch. | [workflows-maintenance-wipe-cache-v1.1.10](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-wipe-cache-v1.1.10) | `uses: TimSchoenle/actions/.github/workflows/maintenance-wipe-cache.yaml@08cf0c8f13696ebdb4b68df6823cdcc93c41b03c # tag=workflows-maintenance-wipe-cache-v1.1.10` |



## ⚙️ Shared Configurations

### GitHub Rulesets

To use, you need to download the rules and Import the ruleset.

| Config | Description |
| --- | --- |
| [Renovate Branches: Trusted Bots & Admins Only](./configs/github-rulesets/branch-renovate_only-allow-trusted-bots-and-admins.json) | Restricts access to Renovate branches, allowing only trusted bots (Renovate, Automatic Release Manager) and admins to manage them, while enforcing code quality and signature requirements. |
| [Release Please Branches: Trusted Bots Only](./configs/github-rulesets/branch-release-please_only-allow-trusted-bots.json) | Restricts access to release-please branches, allowing only trusted bots to create, update, or delete them, while enforcing code quality and signature requirements. |
| [Default Branch: Default Protection Rules](./configs/github-rulesets/branch-default_default-rules.json) | Enforces standard protection rules on the default branch: requires PRs with 1 approval (squash only), signed commits, CodeQL scanning, and passing status checks. |
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
