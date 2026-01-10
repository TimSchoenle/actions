# CI Repository

## 🤖 Keep Actions Up-to-Date

These actions use a specific versioning format (e.g. `actions-name-v1.0.0`) to support multiple actions in one repository.

To ensure **Renovate** can correctly detect new versions and auto-merge updates, simply extend our shared configuration in your `renovate.json`:

```json
{
  "extends": [
    "github>{{REPO}}//configs/renovate/base"
  ]
}
```

## 🚀 Available Actions

Here is a list of all currently maintained actions in this repository:

<!-- ACTIONS_TABLE -->

## 🔄 Reusable Workflows
<!-- WORKFLOWS_TABLE -->

## ⚙️ Shared Configurations

<!-- CONFIGS_TABLE -->

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
