# CI Repository

## 🚀 Available Actions

Here is a list of all currently maintained actions in this repository:

### Common

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Common Modify YAML](./actions/common/modify-yaml) | A action to modify a value in a YAML file while strictly preserving comments and structure | actions-common-modify-yaml-v1.0.2 | `uses: TimSchoenle/actions/actions/common/modify-yaml@actions-common-modify-yaml-v1.0.2` |
| [Common Read YAML](./actions/common/read-yaml) | A action to read a value from a YAML file using dot notation | actions-common-read-yaml-v1.1.0 | `uses: TimSchoenle/actions/actions/common/read-yaml@actions-common-read-yaml-v1.1.0` |

### Helm

| Action | Description | Version | Usage |
| --- | --- | --- | --- |
| [Update Helm Chart Version](./actions/helm/update-chart-version) | Updates a Helm chart version, appVersion, and image tag, then creates a Pull Request. This action requires a bot account with access to the charts repo. Requires structure: Chart.yaml (version, appVersion) and values.yaml (image.tag). | actions-helm-update-chart-version-v1.2.4 | `uses: TimSchoenle/actions/actions/helm/update-chart-version@actions-helm-update-chart-version-v1.2.4` |




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

## ⚙️ Shared Configurations

### Renovate

| Config | Description | Usage |
| --- | --- | --- |
| [actions](./configs/renovate/actions.json) | Versioning rules for all custom Github Actions defined in this repository | `"extends": ["github>TimSchoenle/actions//configs/renovate/actions"]` |
| [base](./configs/renovate/base.json) | Base configuration to handle custom versioning for all resources in this repository. | `"extends": ["github>TimSchoenle/actions//configs/renovate/base"]` |
| [ci-automerge](./configs/renovate/ci-automerge.json) | Auto-merge rules for all none major Github Actions including custom actions defined in this repository. | `"extends": ["github>TimSchoenle/actions//configs/renovate/ci-automerge"]` |



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

> [!NOTE]
> The documentation (this README) is automatically generated and updated via CI on every push and PR. You do not need to manually update it.
