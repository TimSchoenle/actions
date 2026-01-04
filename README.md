# CI Repository

## 🚀 Available Actions

Here is a list of all currently maintained actions in this repository:

| Action | Description | Version | Usage |
|--------|-------------|---------|-------|
| [Update Helm Chart Version](./actions/helm/update-chart-version) | Updates a Helm chart version/APP tag and creates a PR. Requires structure: Chart.yaml (version, appVersion) and values.yaml (image.tag). | actions/helm/update-chart-version-v1.1.0 | `uses: TimSchoenle/actions/actions/helm/update-chart-version@actions/helm/update-chart-version-v1.1.0` |


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
