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
| [Close Pull Request](./actions/common/close-pull-request) | Closes a pull request | [actions-common-close-pull-request-v1.3.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-close-pull-request-v1.3.0) | `uses: TimSchoenle/actions/actions/common/close-pull-request@9fbc10ef6fd97b85a5164a1a19de78a24f130879 # tag=actions-common-close-pull-request-v1.3.0` |
| [Commit Changes](./actions/common/commit-changes) | Commits changes using the GitHub API to ensure verified bot commits. | [actions-common-commit-changes-v1.3.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-commit-changes-v1.3.0) | `uses: TimSchoenle/actions/actions/common/commit-changes@e8af15f00459da30900d926bf8fbb9dea5a56495 # tag=actions-common-commit-changes-v1.3.0` |
| [Common Modify YAML](./actions/common/modify-yaml) | A action to modify a value in a YAML file while strictly preserving comments and structure | [actions-common-modify-yaml-v1.4.1](https://github.com/TimSchoenle/actions/releases/tag/actions-common-modify-yaml-v1.4.1) | `uses: TimSchoenle/actions/actions/common/modify-yaml@492fc0359554c0c739103ca856674c63e47221e2 # tag=actions-common-modify-yaml-v1.4.1` |
| [Common Read YAML](./actions/common/read-yaml) | A action to read a value from a YAML file using dot notation | [actions-common-read-yaml-v1.2.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-read-yaml-v1.2.0) | `uses: TimSchoenle/actions/actions/common/read-yaml@002e4d8660e16322ee409f670fde23b42283efcf # tag=actions-common-read-yaml-v1.2.0` |
| [Create Branch](./actions/common/create-branch) | Creates or resets a git branch using GitHub API. | [actions-common-create-branch-v1.4.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-create-branch-v1.4.0) | `uses: TimSchoenle/actions/actions/common/create-branch@f331b8c387997398a01bf146451f8bc141c860bb # tag=actions-common-create-branch-v1.4.0` |
| [Create Pull Request](./actions/common/create-pull-request) | Creates or updates a pull request using GitHub App authentication with optional branch reset. | [actions-common-create-pull-request-v1.0.11](https://github.com/TimSchoenle/actions/releases/tag/actions-common-create-pull-request-v1.0.11) | `uses: TimSchoenle/actions/actions/common/create-pull-request@29c300df8c740e4b9dc3895c85057b700b226d6c # tag=actions-common-create-pull-request-v1.0.11` |
| [Delete-Branch](./actions/common/delete-branch) | Deletes a branch from a repository. Fails gracefully if the branch does not exist. | [actions-common-delete-branch-v1.3.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-delete-branch-v1.3.0) | `uses: TimSchoenle/actions/actions/common/delete-branch@f7fee33b242c9a529c5246415d29d9d23e511fd3 # tag=actions-common-delete-branch-v1.3.0` |
| [Get App Git Identity](./actions/common/get-app-git-identity) | Resolves the git identity (username, email, user ID) for a GitHub App bot. | [actions-common-get-app-git-identity-v1.3.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-get-app-git-identity-v1.3.0) | `uses: TimSchoenle/actions/actions/common/get-app-git-identity@9f70c391ddc111861f0b01a5b0d310df30ef94e0 # tag=actions-common-get-app-git-identity-v1.3.0` |
| [Render Template](./actions/common/render-template) | A action to render a Handlebars template file to an output file from a JSON map of variables, deterministically | [actions-common-render-template-v1.1.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-render-template-v1.1.0) | `uses: TimSchoenle/actions/actions/common/render-template@2f4ad47204c9bc9f8e0e50ded4e841c57b555396 # tag=actions-common-render-template-v1.1.0` |
| [Render Template And Commit](./actions/common/render-template-and-commit) | Renders a Handlebars template to a file and commits the result as a verified bot commit, skipping the commit when the render changed nothing. | [actions-common-render-template-and-commit-v1.1.2](https://github.com/TimSchoenle/actions/releases/tag/actions-common-render-template-and-commit-v1.1.2) | `uses: TimSchoenle/actions/actions/common/render-template-and-commit@a6ce3fced3785e3a671b45954fd4179848639c5b # tag=actions-common-render-template-and-commit-v1.1.2` |
| [Setup App Git Identity](./actions/common/setup-app-git-identity) | Configures git with the identity of a GitHub App bot and outputs the bot details. | [actions-common-setup-app-git-identity-v1.3.0](https://github.com/TimSchoenle/actions/releases/tag/actions-common-setup-app-git-identity-v1.3.0) | `uses: TimSchoenle/actions/actions/common/setup-app-git-identity@2b241369e824822cae66f889c9b7e589538471f6 # tag=actions-common-setup-app-git-identity-v1.3.0` |

### Helm

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Apply Helm Chart Updates](./actions/helm/apply-chart-updates) | Applies a set of templated image updates to a Helm chart's values.yaml and bumps Chart.yaml, preserving comments and structure. Every image carries its own version and digest. | [actions-helm-apply-chart-updates-v1.2.0](https://github.com/TimSchoenle/actions/releases/tag/actions-helm-apply-chart-updates-v1.2.0) | `uses: TimSchoenle/actions/actions/helm/apply-chart-updates@aebfd5f7e68f91a047f417b12c4d4eb3f78c5740 # tag=actions-helm-apply-chart-updates-v1.2.0` |
| [Update Helm Chart Version](./actions/helm/update-chart-version) | Updates a Helm chart's image tags, version and appVersion, then opens a Pull Request. Every image carries its own version and digest, so one call can move a chart with many services. This action requires a bot account with access to the charts repo. | [actions-helm-update-chart-version-v1.6.0](https://github.com/TimSchoenle/actions/releases/tag/actions-helm-update-chart-version-v1.6.0) | `uses: TimSchoenle/actions/actions/helm/update-chart-version@a9b52e270a60b696cb1c90f996f01977bf27a7c1 # tag=actions-helm-update-chart-version-v1.6.0` |

### Helper

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Helper Verify-branch-name](./actions/helper/verify-branch-name) | Verify the head branch of a pull request matches a pattern and check whether it comes from a fork | [actions-helper-verify-branch-name-v1.3.0](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-verify-branch-name-v1.3.0) | `uses: TimSchoenle/actions/actions/helper/verify-branch-name@95d195726cca549102183aacf21e98d2f12766a3 # tag=actions-helper-verify-branch-name-v1.3.0` |
| [Resolve Branch](./actions/helper/resolve-base-branch) | Resolve the given base branch or return default branch. With optional existence check. | [actions-helper-resolve-base-branch-v1.3.0](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-resolve-base-branch-v1.3.0) | `uses: TimSchoenle/actions/actions/helper/resolve-base-branch@3f494a9fdbe97d9680d892fe5726464c428acd73 # tag=actions-helper-resolve-base-branch-v1.3.0` |
| [Verify Commit Authors](./actions/helper/verify-commit-authors) | Verifies that all commits in a PR are authored by a specific set of users and are signed. | [actions-helper-verify-commit-authors-v1.3.0](https://github.com/TimSchoenle/actions/releases/tag/actions-helper-verify-commit-authors-v1.3.0) | `uses: TimSchoenle/actions/actions/helper/verify-commit-authors@3a01b3591c93da96400d481ef1f41c1b4ee3f83b # tag=actions-helper-verify-commit-authors-v1.3.0` |

### Java-gradle

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Java-gradle Auto-spotless](./actions/java-gradle/auto-spotless) | Automatically apply spotless formatting and commit changes. | [actions-java-gradle-auto-spotless-v1.1.14](https://github.com/TimSchoenle/actions/releases/tag/actions-java-gradle-auto-spotless-v1.1.14) | `uses: TimSchoenle/actions/actions/java-gradle/auto-spotless@6b2765073d10b07d6e0b0189d913443f1a823396 # tag=actions-java-gradle-auto-spotless-v1.1.14` |
| [Java-Gradle default setup](./actions/java-gradle/setup-base-environment) | Setup Java and Gradle environment for building, with opinionated default settings | [actions-java-gradle-setup-base-environment-v1.2.9](https://github.com/TimSchoenle/actions/releases/tag/actions-java-gradle-setup-base-environment-v1.2.9) | `uses: TimSchoenle/actions/actions/java-gradle/setup-base-environment@e9ac4a44bc0c474dc91d1e0e69d61d8bf8aa8f46 # tag=actions-java-gradle-setup-base-environment-v1.2.9` |

### Maintenance

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Maintenance Auto-approve-pr](./actions/maintenance/auto-approve-pr) | Auto approve Pull Requests with the given user ids and branches. | [actions-maintenance-auto-approve-pr-v1.3.0](https://github.com/TimSchoenle/actions/releases/tag/actions-maintenance-auto-approve-pr-v1.3.0) | `uses: TimSchoenle/actions/actions/maintenance/auto-approve-pr@c2a89dd764db49f63ee6a1ab15d2ab24255576f6 # tag=actions-maintenance-auto-approve-pr-v1.3.0` |
| [Maintenance Ensure-actions-are-executed](./actions/maintenance/ensure-actions-are-executed) | Ensures selected checks completed successfully when they were started. | [actions-maintenance-ensure-actions-are-executed-v1.3.0](https://github.com/TimSchoenle/actions/releases/tag/actions-maintenance-ensure-actions-are-executed-v1.3.0) | `uses: TimSchoenle/actions/actions/maintenance/ensure-actions-are-executed@8b17f68e9dc9836b7a1164181ca3ceca1bdf6e0e # tag=actions-maintenance-ensure-actions-are-executed-v1.3.0` |

### Rust

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Rust Auto-format](./actions/rust/auto-format) | Action that runs cargo fmt and commits changes. | [actions-rust-auto-format-v1.1.10](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-auto-format-v1.1.10) | `uses: TimSchoenle/actions/actions/rust/auto-format@actions-rust-auto-format-v1.1.10 # tag=actions-rust-auto-format-v1.1.10` |
| [Rust Cargo-check](./actions/rust/cargo-check) | Action that runs cargo check to verify Rust code compiles without errors. | [actions-rust-cargo-check-v1.1.5](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-cargo-check-v1.1.5) | `uses: TimSchoenle/actions/actions/rust/cargo-check@5798c7bd8d1d98a0c7360114e91a0ac3b86bf145 # tag=actions-rust-cargo-check-v1.1.5` |
| [Rust Clippy](./actions/rust/clippy) | Action that runs clippy to catch common mistakes and improve your Rust code. | [actions-rust-clippy-v1.1.9](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-clippy-v1.1.9) | `uses: TimSchoenle/actions/actions/rust/clippy@dcfb46a6a17ad8565db74057ce60278953056ad5 # tag=actions-rust-clippy-v1.1.9` |
| [Rust Coverage (Codecov)](./actions/rust/coverage-codecov) | Action that runs cargo llvm-cov to generate code coverage and uploads to Codecov. | [actions-rust-coverage-codecov-v1.1.35](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-coverage-codecov-v1.1.35) | `uses: TimSchoenle/actions/actions/rust/coverage-codecov@5204557f5d5916467471d091d68724a3ef3315a0 # tag=actions-rust-coverage-codecov-v1.1.35` |
| [Rust Test](./actions/rust/test) | Action that runs cargo nextest to verify Rust code passes tests. | [actions-rust-test-v1.1.1](https://github.com/TimSchoenle/actions/releases/tag/actions-rust-test-v1.1.1) | `uses: TimSchoenle/actions/actions/rust/test@c6844b562767b6e68fff4d39bdf9eced6e29b318 # tag=actions-rust-test-v1.1.1` |

### Test

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Setup E2E Test](./actions/test/setup-e2e) | Sets up the environment for E2E testing: generates token, checks out test repo, and checks out actions code. | [actions-test-setup-e2e-v1.2.2](https://github.com/TimSchoenle/actions/releases/tag/actions-test-setup-e2e-v1.2.2) | `uses: TimSchoenle/actions/actions/test/setup-e2e@9aabf0be4b0008aa5bdc479b556851c3a5c54d93 # tag=actions-test-setup-e2e-v1.2.2` |



## 🔄 Reusable Workflows
### Maintenance

| Workflow | Description | Version | Usage |
| --- | --- | --- | --- |
| [Auto Format](./workflows/maintenance/auto-bun-prettier) | Reusable workflow to auto-format code using Bun (Prettier) and commit changes. | [workflows-maintenance-auto-bun-prettier-v1.1.25](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-bun-prettier-v1.1.25) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-bun-prettier.yaml@35f1c5f214eccc64ea61a87fdce38c7bc298aeca # tag=workflows-maintenance-auto-bun-prettier-v1.1.25` |
| [Auto-Approve & Merge Timed PRs](./workflows/maintenance/timed-auto-pr-approve) | Reusable workflow that automatically verifies, approves, and merges Pull Requests that match a specific branch pattern and have been open for a configurable duration. It ensures all commits are signed and authored by trusted users. | [workflows-maintenance-timed-auto-pr-approve-v1.2.28](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-timed-auto-pr-approve-v1.2.28) | `uses: TimSchoenle/actions/.github/workflows/maintenance-timed-auto-pr-approve.yaml@afe88e20c75e55e503534a3e56d890196e96d1d7 # tag=workflows-maintenance-timed-auto-pr-approve-v1.2.28` |
| [Maintenance Auto-approve-renovate](./workflows/maintenance/auto-approve-renovate) | Reusable workflow to auto approve Renovate PRs, this is useful to auto merge Renovate PRs which have auto-merge enabled. | [workflows-maintenance-auto-approve-renovate-v1.4.17](https://github.com/TimSchoenle/actions/releases/tag/workflows-maintenance-auto-approve-renovate-v1.4.17) | `uses: TimSchoenle/actions/.github/workflows/maintenance-auto-approve-renovate.yaml@2daf702fcb1c9bd2c8831aae68d403f85c9f4344 # tag=workflows-maintenance-auto-approve-renovate-v1.4.17` |
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
