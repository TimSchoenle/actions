# Render README

Renders `README.md` from its Handlebars template with the shared README payload. It is the README job every repository
repeats, in one step: [`common/readme-variables`](../readme-variables) collects the payload,
[`common/render-template`](../render-template) renders it, and [`common/create-patch`](../create-patch) uploads the
result as a generator patch for [`common/generated-files-verdict`](../generated-files-verdict).

With `check: true` it writes nothing and fails when the committed file is stale: the drift gate for pushes to the
default branch and for forks.

## Usage

As a generator job of a repository's Generate workflow:

```yaml
jobs:
  readme:
    name: README
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      has_changes: ${{ steps.readme.outputs.has_changes }}
      artifact_name: ${{ steps.readme.outputs.artifact_name }}
    steps:
      - uses: actions/checkout@<sha> # v7
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          persist-credentials: false
      - id: readme
        uses: TimSchoenle/actions/actions/common/render-readme@<sha> # tag=actions-common-render-readme-v1.1.0
```

As the drift gate on the default branch:

```yaml
      - uses: TimSchoenle/actions/actions/common/render-readme@<sha> # tag=actions-common-render-readme-v1.1.0
        with:
          check: 'true'
```

Give both the same inputs: the gate reproduces the render and compares, so any difference would pass a stale file.

## Inputs

| Input             | Required | Default                           | Description                                                                 |
| ----------------- | -------- | --------------------------------- | --------------------------------------------------------------------------- |
| `template`        | no       | `.github/templates/README.md.hbs` | Handlebars template to render.                                              |
| `output`          | no       | `README.md`                       | File to write.                                                              |
| `partials-dir`    | no       |                                   | Directory of Handlebars partials. Empty for none.                           |
| `manifest`        | no       |                                   | Manifest the version is read from, as readme-variables takes it.            |
| `docs-dir`        | no       | `docs`                            | Directory of documents listed in the payload.                               |
| `extra`           | no       | `{}`                              | JSON object merged into the payload, such as a repository's own generator.  |
| `branch`          | no       |                                   | Branch written into the payload. Empty means the default branch.            |
| `check`           | no       | `false`                           | `true` writes nothing and fails on a stale file.                            |
| `artifact_name`   | no       | `readme-render`                   | Name of the create-patch artifact. Unused with `check: true`.               |
| `max_patch_bytes` | no       | `10485760`                        | Largest patch, in bytes.                                                    |

## Outputs

| Output          | Description                                                                         |
| --------------- | ----------------------------------------------------------------------------------- |
| `has_changes`   | `true` when the render differs from the committed file. Empty with `check: true`.    |
| `artifact_name` | Name of the uploaded patch artifact. Empty with `check: true`.                       |

## Behaviour

- **`branch` defaults to the default branch, not `github.ref_name`.** On a pull request that is `<number>/merge`;
  rendered into badge URLs, it would make the generator and the drift gate disagree on every merge.
- **`check` must be `true` or `false`** (case and surrounding spaces are ignored); anything else fails the step. With
  an empty `branch` on an event whose payload names no default branch, the step fails and asks for `branch`.
- **The patch covers `output` only.** A template that starts writing elsewhere is not picked up.
- The job needs `contents: read` only. It runs the pull request's template, so give it no secret.
