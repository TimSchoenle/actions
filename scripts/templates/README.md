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

[![CI](https://img.shields.io/github/actions/workflow/status/{{REPO}}/scripts-ci.yml?branch=main&label=ci)](https://github.com/{{REPO}}/actions/workflows/scripts-ci.yml)
[![License](https://img.shields.io/github/license/{{REPO}})](LICENSE)

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
  "extends": ["github>{{REPO}}//configs/renovate/base"]
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

<!-- ACTIONS_TABLE -->

### Reusable workflows

Releasing one of these publishes it onto its tag at `.github/workflows/<category>-<name>.yaml`,
which is the path the `uses:` line resolves. Read and change the source under `workflows/`.

<!-- WORKFLOWS_TABLE -->

### Shared configurations

The Renovate presets are consumed through `extends`. The ruleset files are GitHub's own export
format: download one and import it under the repository's Settings, then Rules.

<!-- CONFIGS_TABLE -->

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
