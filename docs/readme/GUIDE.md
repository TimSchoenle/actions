# The README contract

What a README contains, in what order, and how CI keeps it true. Prose style is
[PROSE.md](./PROSE.md); this is structure and machinery.

## Contents

- [The rule underneath](#the-rule-underneath)
- [The payload](#the-payload)
- [Section order](#section-order)
- [Rules that are not negotiable](#rules-that-are-not-negotiable)
- [Archetypes](#archetypes)
- [The workflow](#the-workflow)
- [Traps](#traps)
- [Before you open the pull request](#before-you-open-the-pull-request)

## The rule underneath

**Any string that also lives in a manifest comes from the payload.**

No typed version, tag, image name, MSRV, licence identifier or chart version. That is the rule the
whole system exists to enforce, and every other rule here supports it. A README that quotes a version
is a README that is wrong one release later; a README that interpolates one is corrected by the commit
that bumps it.

The check that makes it real is a job rendering the template with `check: 'true'` and failing when the
committed file differs. Make it a required check. Without that the template is documentation about
documentation.

## The payload

[readme-variables](../../actions/common/readme-variables) reads the repository's manifest, walks
`docs/`, and emits one strict-JSON object. Its README documents every field; the shape is:

```json
{
  "repo": { "owner", "name", "slug", "branch", "url", "ecosystem", "manifest",
            "package", "description", "license", "homepage" },
  "release": { "version", "tag" },
  "toolchain": { "msrv" | "jdk" | "node", "edition", "gradle", "appVersion", "kubeVersion" },
  "docs": [ { "path", "title", "summary" } ]
}
```

It reads `Cargo.toml`, `package.json`, `Chart.yaml` or `gradle.properties`, detected in that order or
named through the `manifest` input. Nothing reaches it from the network, the clock or the environment,
which is what lets `check: 'true'` be a merge gate rather than a suggestion.

**Absent facts are omitted, not emitted empty.** `repo.package`, `repo.description`, `repo.license`
and `repo.homepage` are left out when the manifest has none, so strict mode fails on a template that
names one. That is the signal you want: a blank where a project's one-liner belongs is worse than a
red step. Either add the field to the manifest — the right answer — or guard the reference with
`{{#if repo.description}}`.

Anything the action cannot derive — configuration tables, publish targets, a rendered example file —
comes from the repository's own generator through the `extra` input, deep-merged over the derived
payload.

## Section order

Sections that do not apply are omitted. None is reordered, and nothing is inserted between them.

| #   | Section                               | Source                            |
| --- | ------------------------------------- | --------------------------------- |
| 00  | Provenance banner, as an HTML comment | authored                          |
| 01  | `H1` title                            | `{{ repo.name }}`                 |
| 02  | One-line description                  | `{{ repo.description }}`          |
| 03  | Badge row                             | payload                           |
| 04  | What this is                          | authored                          |
| 05  | Quick start                           | payload                           |
| 06  | Table of contents                     | only above 100 rendered lines     |
| 07  | Features                              | authored                          |
| 08  | Installation                          | payload                           |
| 09  | Usage                                 | authored                          |
| 10  | Configuration                         | generated tables                  |
| 11  | Operations                            | services only                     |
| 12  | Compatibility                         | `{{ toolchain.* }}`               |
| 13  | Documentation                         | `{{#each docs}}`                  |
| 14  | Contributing                          | authored, short                   |
| 15  | Security                              | authored, short                   |
| 16  | License                               | `{{ repo.license }}`, always last |

**The banner** names the template path, the payload command and the check that gates drift. It
survives into the rendered file on purpose: that is where whoever is about to edit the wrong file
will be looking.

**What this is** is two to four sentences on the problem it solves and who it is for. Not a feature
list restated as prose.

**Quick start** is one copy-pasteable block that reaches a working result in under a minute.

**Configuration** carries the full table only when it fits in roughly forty rows. Past that: the five
most-used keys, and a link to a generated `docs/CONFIGURATION.md`.

## Rules that are not negotiable

- Exactly one `H1`. No skipped heading levels. **No emoji in headings.**
- Under **400 rendered lines**. Past that, content moves to `docs/` and the generated documentation
  table links it.
- **At most five badges**, every one a link, in this order: release/version, CI, coverage, licence,
  MSRV or JDK. Drop one that does not apply rather than substituting a decorative one. No visitor
  counters, no "made with love".
- Every fenced block is language-tagged.
- In-repo links are relative; cross-repo links are absolute.
- Never put a fenced config dump where its comments will be parsed as headings. It wrecks the
  outline, and the outline is how GitHub builds its "Outline" panel.

## Archetypes

The order never changes. What changes is which sections apply and which badges resolve.

| Archetype        | Install sections                   | Dropped                           | Badges                                 |
| ---------------- | ---------------------------------- | --------------------------------- | -------------------------------------- |
| Library          | package manager, or git dependency | Operations                        | registry, docs, CI, licence, MSRV      |
| Service          | Docker, Helm, source               | —                                 | image, CI, coverage, licence, MSRV     |
| Application      | Docker, source                     | —                                 | CI, coverage, licence, MSRV, live site |
| Chart collection | Helm                               | Configuration, which is per chart | CI, licence                            |
| JVM artefact     | Gradle, Maven                      | Operations                        | Maven Central, CI, licence, JDK        |
| CI monorepo      | —                                  | Configuration, Operations         | CI, licence                            |

A library that is not published to a registry documents the tagged git dependency and says so. Do not
write a `cargo add` line for a crate with `publish = false`.

## The workflow

Two jobs. Copy every third-party pin from a neighbouring workflow in the same repository rather than
inventing one.

```yaml
name: docs

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions: {}

jobs:
  # Renders and commits back to the pull request. An unchanged render produces no commit.
  render:
    name: render
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read # the commit is made through the App token below
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@<sha> # v2.21.0
        with:
          egress-policy: audit

      - name: Generate Bot Token
        id: generate_token
        uses: actions/create-github-app-token@<sha> # v3.2.0
        with:
          app-id: ${{ secrets.ACTIONS_MAINTENANCE_APP_ID }}
          private-key: ${{ secrets.ACTIONS_MAINTENANCE_PRIVATE_KEY }}
          # Scope it. An unscoped App token inherits every permission the installation holds,
          # which zizmor's `github-app` rule reports as an error.
          permission-contents: write

      - name: Checkout
        uses: actions/checkout@<sha> # v7
        with:
          ref: ${{ github.head_ref }}
          persist-credentials: false
          token: ${{ steps.generate_token.outputs.token }}

      # Only where the repository has its own generator. See "Traps" before writing this.
      - name: Generate the configuration payload
        id: config
        run: |
          set -euo pipefail
          json="$(<the repository's generator>)"
          echo "json=${json}" >> "$GITHUB_OUTPUT"

      - name: Collect the README payload
        id: variables
        uses: TimSchoenle/actions/actions/common/readme-variables@b5b5c9e047f00ffa00b7772536c8bdb4f158f706 # tag=actions-common-readme-variables-v1.1.0
        with:
          branch: ${{ github.event.repository.default_branch }}
          extra: ${{ steps.config.outputs.json }}

      - name: Render and commit the README
        uses: TimSchoenle/actions/actions/common/render-template-and-commit@15d83f02081c9dc8a844646199c63792dcccdfa8 # tag=actions-common-render-template-and-commit-v1.1.3
        with:
          template: .github/templates/README.md.hbs
          output: README.md
          variables: ${{ steps.variables.outputs.variables }}
          token: ${{ steps.generate_token.outputs.token }}
          commit_message: 'docs: render README from its template'

  # The drift gate. Make this a required check.
  verify:
    name: readme
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@<sha> # v2.21.0
        with:
          egress-policy: audit

      - name: Checkout
        uses: actions/checkout@<sha> # v7
        with:
          persist-credentials: false

      - name: Generate the configuration payload
        id: config
        run: |
          set -euo pipefail
          json="$(<the repository's generator>)"
          echo "json=${json}" >> "$GITHUB_OUTPUT"

      - name: Collect the README payload
        id: variables
        uses: TimSchoenle/actions/actions/common/readme-variables@b5b5c9e047f00ffa00b7772536c8bdb4f158f706 # tag=actions-common-readme-variables-v1.1.0
        with:
          branch: ${{ github.event.repository.default_branch }}
          extra: ${{ steps.config.outputs.json }}

      - name: Verify README.md is current
        uses: TimSchoenle/actions/actions/common/render-template@3b7d152374ee63e720e7c16bed8b088b40554911 # tag=actions-common-render-template-v1.1.1
        with:
          template: .github/templates/README.md.hbs
          output: README.md
          variables: ${{ steps.variables.outputs.variables }}
          check: 'true'
```

The `# tag=` comment is not decoration. Renovate matches it to keep the pin current, and a pin without
one goes stale silently.

Adapting an existing docs workflow is preferred over replacing it, and the repository's own payload
generator is never deleted — that generator is where the configuration tables come from.

## Traps

Four things that have each cost real debugging time.

### `extra` merges, and a same-named key replaces

A generator emitting `"repo": "owner/name"` as a **string** flattens the action's `repo` **object**,
taking `repo.slug`, `repo.url`, `repo.description` and `repo.license` with it. Audit any generator for
`repo`, `branch`, `release`, `toolchain` and `docs` before wiring it in, and strip those from the
generator rather than working around them in the template.

Arrays replace rather than concatenate. A caller supplying `publish.crates` means _these are the
crates_; appending to a derived list would make the result depend on what the reader happened to find.

### Set `branch` explicitly

```yaml
branch: ${{ github.event.repository.default_branch }}
```

The action defaults `branch` to `github.ref_name`, which on a `pull_request` event is `<number>/merge`.
Left alone it writes `?branch=42/merge` into badge and permalink URLs, and the drift gate then fails on
every merge for a reason invisible in the diff.

### Assign the payload before echoing it

```bash
# Wrong. Exit status belongs to `echo`, so a failed generator leaves the step green.
echo "json=$(generator)" >> "$GITHUB_OUTPUT"

# Right. `set -e` does abort on a failed assignment.
json="$(generator)"
echo "json=${json}" >> "$GITHUB_OUTPUT"
```

With the first form, a generator that fails produces an empty `extra`, readme-variables reads empty
`extra` as `{}` by design, and the failure surfaces as a strict-mode error about an undefined template
variable several steps later. That is exactly how it presented the one time it happened: a Gradle
build that could not configure reported `"id" not defined in undefined`.

Prefer reading values out of files over invoking a build tool at all. A build that cannot configure is
one more thing between the facts and the render.

### Strict mode does not descend into blocks

`{{ missing }}` throws. `{{#each missing}}` renders nothing, silently. Names _inside_ an `{{#each}}`
body are not checked either, so give optional fields a fallback:

```handlebars
{{#each docs}}| [{{path}}]({{path}}) |
  {{default (mdCell summary) '—'}}
  |
{{/each}}
```

## Before you open the pull request

1. `README.md` renders from the template, banner included.
2. A `verify` job renders with `check: 'true'` and fails on any difference.
3. Section order holds; only inapplicable sections are missing.
4. No manifest-derived string is typed into the template.
5. One `H1`, no skipped levels, no emoji in headings, under 400 lines.
6. Both [PROSE.md](./PROSE.md) checks are within budget.
7. Every fence is language-tagged; every in-repo link resolves.
8. The quick start has been run from a clean checkout.
9. The repository description and topics match what the payload emits.
