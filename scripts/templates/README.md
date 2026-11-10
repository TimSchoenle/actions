<!--
Generated from scripts/templates/README.md by `bun run generate-docs`. Edit the template, not this
file.

Every row below is read out of the repository itself. Each `action.yaml` and `configs/*.json`
supplies its own name and description, `.release-please-manifest.json` supplies the released
version, and every tag is resolved to the commit it points at, so the `uses:` lines are SHA pins
rather than moving references.

The update-readme job in .github/workflows/update-files.yml runs the same command on every pull
request and commits the result back to the branch. An edit made here is overwritten, not merged.
-->

# Actions

Composite and Node GitHub Actions and shared Renovate presets, each released under its own tag.

[![CI](https://img.shields.io/github/actions/workflow/status/{{REPO}}/scripts-ci.yml?branch=main&label=ci)](https://github.com/{{REPO}}/actions/workflows/scripts-ci.yml)
[![License](https://img.shields.io/github/license/{{REPO}})](LICENSE)

## What this is

One repository holding the CI parts the other repositories in this account call: the actions under
`actions/`, and the Renovate presets and branch rulesets under `configs/`.

Each directory is its own release-please component, so `actions/rust/clippy` and
`actions/bun/setup-cached` are versioned and tagged apart from each other. A tag names the component
it belongs to, as `actions-<path>-vX.Y.Z` or `configs-<path>-vX.Y.Z`. The tables below carry the
current tag of every component and the `uses:` line that pins it.

`main` holds sources only. Each release tag points at a build commit on the `releases` branch: the
released source commit plus every action bundle, built from it in CI and attested. The
`src-<component>-vX.Y.Z` tags mark the released source commits on `main` for release-please and are
not meant to be pinned. [docs/release-pipeline.md](docs/release-pipeline.md) describes the pipeline,
and [SECURITY.md](SECURITY.md#verifying-a-release) how to verify a release.

## Quick start

Copy a `uses:` line from the tables below. It pins the released tag to the build commit that tag
points at, and repeats the tag in a trailing comment.

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
  - [Shared configurations](#shared-configurations)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Usage

### Actions

The first column links to the action's directory. Its `action.yaml` declares the inputs and the
outputs. Where an action needs more than that, a README sits next to it.

<!-- ACTIONS_TABLE -->

### Shared configurations

The Renovate presets are consumed through `extends`. The ruleset files are GitHub's own export
format: download one and import it under the repository's Settings, then Rules.

Each Checkstyle ruleset lives in its own directory under `configs/checkstyle/`, alongside a
`configs/checkstyle/_shared/` directory holding Lombok-annotation suppressions common to every
ruleset. Checkstyle's `${config_loc}` is a convention property your build tool sets to a local
directory (Gradle's `checkstyle.configDirectory`, Maven's `propertyExpansion`) — it is never
derived from a remote `configLocation` URL — so a ruleset only resolves its suppression files, its
`../_shared/` sibling included, once you vendor both directories into your project and point your
build tool's config directory at your copy of the ruleset directory.

<!-- CONFIGS_TABLE -->

## Documentation

`docs/` holds the two writing standards every repository in this account is held to, which other
repositories link from their own `CONTRIBUTING.md` instead of keeping a copy, and how this repository
releases.

| Document | Purpose |
| --- | --- |
| [docs/readme/README.md](docs/readme/README.md) | What a README contains and in what order, how its prose is written, the template it starts from and the CI job that keeps it rendered. |
| [docs/doc-comments/README.md](docs/doc-comments/README.md) | What carries a doc comment and what it says, with an annex each for Rust, Java and TypeScript. |
| [docs/release-pipeline.md](docs/release-pipeline.md) | How a release is built, attested and published on a build commit, the runbook for a failed release, the repository settings it needs and how to roll it back. |
| [docs/adopting-build-on-release.md](docs/adopting-build-on-release.md) | Reference release workflows for another repository: a single action at the root, and a release-please monorepo. |

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the commit
convention release-please reads, the interactive generators that scaffold a new action, and the
checks CI runs. This file and SECURITY.md are generated. An edit to either is reverted on the next
pull request.

## Security

Do not open a public issue for a vulnerability. [SECURITY.md](SECURITY.md) has the private reporting
route and the list of supported versions.

## License

Every action and config here is published under the terms in [LICENSE](LICENSE).
