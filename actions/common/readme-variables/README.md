# Common Readme Variables

Collects the render payload a README template interpolates, as strict JSON, from the files already in the checkout.

It is the input half of [Common Render Template](../render-template): this action produces the `variables` map, that one
renders the template against it. Splitting them is what lets thirteen repositories share one template vocabulary while
each keeps its own manifest.

Nothing here reads the network, the clock or the environment. The same commit produces the same payload on a developer's
machine and on a runner, which is the property that makes `check: true` in render-template a merge gate rather than a
suggestion.

## Usage

```yaml
- name: Collect the README payload
  id: variables
  uses: TimSchoenle/actions/actions/common/readme-variables@<sha> # tag=actions-common-readme-variables-v1.0.0

- name: Render the README
  uses: TimSchoenle/actions/actions/common/render-template@<sha> # tag=actions-common-render-template-v1.1.1
  with:
    template: .github/templates/README.md.hbs
    output: README.md
    variables: ${{ steps.variables.outputs.variables }}
```

### With a repository's own generator

Facts this action cannot derive — configuration tables, publish targets, a rendered example file — arrive through
`extra` and are merged over the derived payload:

```yaml
- name: Generate the configuration payload
  id: config
  run: |
    set -euo pipefail
    echo "json=$(cargo run -q -p portfolio-config --features config-schema \
      --example config-schema -- --format variables)" >> "$GITHUB_OUTPUT"

- name: Collect the README payload
  id: variables
  uses: TimSchoenle/actions/actions/common/readme-variables@<sha> # tag=actions-common-readme-variables-v1.0.0
  with:
    extra: ${{ steps.config.outputs.json }}
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `manifest` | no | *(detect)* | Path the release and toolchain facts are read from. Empty detects `Cargo.toml`, `package.json`, `Chart.yaml` or `gradle.properties`, in that order. |
| `docs-dir` | no | `docs` | Directory walked to build the documentation index. |
| `extra` | no | `{}` | Strict JSON object deep-merged over the derived payload. |
| `repository` | no | `${{ github.repository }}` | Repository the payload describes, as `owner/name`. |
| `branch` | no | `${{ github.ref_name }}` | Branch permanent links point at. |
| `tag-prefix` | no | `v` | Joined to the version to form `release.tag`. |

## Outputs

| Output | Description |
| --- | --- |
| `variables` | The payload as strict JSON on one line, ready for render-template's `variables` |
| `version` | The version read from the manifest |
| `tag` | The version with `tag-prefix` applied |
| `manifest-path` | The manifest the facts came from, as given or as detected |

## The payload

```json
{
  "repo": {
    "owner": "TimSchoenle",
    "name": "Portfolio",
    "slug": "TimSchoenle/Portfolio",
    "branch": "main",
    "url": "https://github.com/TimSchoenle/Portfolio",
    "ecosystem": "cargo",
    "manifest": "Cargo.toml",
    "package": "portfolio-platform",
    "description": "Dioxus fullstack (SSR + hydration) portfolio served by Axum.",
    "license": "LicenseRef-Proprietary"
  },
  "release": { "version": "2.7.1", "tag": "v2.7.1" },
  "toolchain": { "msrv": "1.97", "edition": "2024" },
  "docs": [{ "path": "docs/DEPLOYMENT.md", "title": "Deployment", "summary": "Container, Helm and reproducible builds." }]
}
```

`repo.package`, `repo.description`, `repo.license` and `repo.homepage` are **omitted** when the manifest does not carry
them, rather than emitted empty. render-template's strict mode then fails on a template that names one, which is the
signal wanted: a blank where a project's one-liner belongs is worse than a red step.

The repository description comes from the manifest and deliberately not from the GitHub API. A description edited in the
web UI would otherwise change the rendered README with no commit behind it, and the next unrelated pull request would
fail the drift gate for a reason nobody could find in its diff. The manifest is the source; the repository's own
description is set to match it.

## Manifests

| File | `release.version` | `toolchain` |
| --- | --- | --- |
| `Cargo.toml` | `[package] version` | `msrv` from `rust-version`, `edition` |
| `package.json` | `version` | `node` from `engines.node` |
| `Chart.yaml` | `version` — the chart's own | `appVersion`, `kubeVersion` |
| `gradle.properties` | `version` | `jdk`, `gradle` |

`Cargo.toml` is read without a TOML parser. What a README quotes is a handful of top-level string fields in the
`[package]` table, and the parse is anchored to the line start — a dependency's version sits inside an inline table and
never starts a line, so `version` cannot come from one.

A member manifest carrying `version.workspace = true` fails with a message naming the workspace root, rather than
reporting a bare absence.

Gradle reads `gradle.properties` and not `build.gradle`, because the build script is a program and the version in it can
be computed. A project that computes its version writes it to the properties file for this action to read.

## Docs index

Every file under `docs-dir`, depth-first and sorted, so the rendered table cannot reorder itself between runners.
Markdown is indexed by its own first heading and first paragraph — front matter, fenced blocks and the HTML comment
banner that opens every generated file are all skipped. Anything else is indexed by path with no summary, because
`docs/config.contract.json` is a document a reader follows a link to and leaving it out would make the table lie.

A `docs-dir` that does not exist yields an empty index. That is not an error: most repositories have no `docs/` yet, and
failing on its absence would make adopting the standard a two-step migration for no gain.

## Merging

`extra` is deep-merged over the derived payload, so a repository can add facts or correct one this action got wrong
without waiting for a release here.

- **Objects** merge key by key.
- **Arrays replace.** A caller supplying `publish.crates` means *these are the crates*; appending to a derived list would
  make the result depend on what the reader happened to find.
- **`null` replaces**, which is how a caller deletes a derived field while leaving the name defined for strict mode.

Keys that would reach `Object.prototype` — `__proto__`, `constructor`, `prototype` — are rejected rather than stripped,
on the same terms as render-template's variables: this payload is rendered by that template, and
`{{ constructor.constructor }}` is the classic Handlebars sandbox escape.

## Paths

`manifest` and `docs-dir` are validated against the workspace before a file is read. `..` and an absolute path are both
refused, and the error names the path as the caller wrote it rather than as it resolved.
