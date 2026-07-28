# Common Render Template And Commit

Renders a [Handlebars](https://handlebarsjs.com/) template to a file and commits the result as a **verified** bot commit
— the two-step pairing that regenerating a checked-in file always needs, in one step.

It composes two released actions and adds nothing of its own beyond the wiring:

- [`common/render-template`](../render-template) writes the file.
- [`common/commit-changes`](../commit-changes) commits it through the GraphQL API, so GitHub signs the commit.

The commit step is **skipped when the render changed nothing**. Rendering is deterministic, so a scheduled regeneration
over unchanged inputs makes no commit and no API call.

## Usage

```yaml
- uses: actions/checkout@v6

- uses: actions/create-github-app-token@v3
  id: token
  with:
    app-id: ${{ secrets.BOT_APP_ID }}
    private-key: ${{ secrets.BOT_PRIVATE_KEY }}

- uses: <owner>/actions/actions/common/render-template-and-commit@<ref>
  id: docs
  with:
    template: docs/README.hbs
    output: README.md
    partials-dir: docs/partials
    variables: ${{ steps.collect.outputs.data }}
    token: ${{ steps.token.outputs.token }}
    commit_message: 'docs: regenerate README'

- run: echo "Committed ${{ steps.docs.outputs.commit_url }}"
  if: steps.docs.outputs.changes_detected == 'true'
```

The template, its partials and the output path are all read from and written to the workspace, so **the caller owns the
checkout**. This action does not check anything out, which is what lets it run mid-workflow, after whatever step produced
the variables.

`token` must be a **GitHub App installation token** with `contents: write` on the target repository. The default
`GITHUB_TOKEN` produces an unverified commit and will not trigger downstream workflows.

## Inputs

| Input            | Required | Default                                 | Description                                                                                     |
| ---------------- | -------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `template`       | yes      |                                         | Path to the template file.                                                                       |
| `output`         | yes      |                                         | Path to write the rendered result to. Missing parent directories are created.                    |
| `variables`      | no       | `{}`                                    | Template variables as a **strict JSON object**. Not YAML.                                        |
| `partials-dir`   | no       | `''`                                    | Directory of reusable `.hbs` partials.                                                           |
| `strict`         | no       | `true`                                  | Fail on a reference the variables do not define.                                                 |
| `escape-html`    | no       | `false`                                 | HTML-escape interpolated values.                                                                 |
| `token`          | yes      |                                         | App installation token to commit with.                                                           |
| `commit_message` | yes      |                                         | The commit message.                                                                              |
| `repository`     | no       | `${{ github.repository }}`              | Repository to commit to, as `owner/repo`.                                                        |
| `branch`         | no       | `${{ github.head_ref \|\| github.ref_name }}` | Branch to commit to.                                                                        |
| `file_pattern`   | no       | the rendered `output` path              | What to commit. See below.                                                                       |

See [`common/render-template`](../render-template) for the template language, the helper set, strict mode and partial
resolution — every rendering input behaves exactly as it does there.

### `file_pattern`

By default only the rendered file is committed, not the whole workspace. That is the difference that matters when a
build step left artefacts behind: a documentation commit stays a documentation commit.

Override it to commit more, using the same pathspec syntax `commit-changes` accepts:

```yaml
file_pattern: 'README.md SECURITY.md docs/**/*.md'
```

The override is used verbatim; it is not merged with the output path, so an override that does not match the rendered
file will not commit it.

### `check` is deliberately not exposed

`render-template`'s `check` mode writes nothing, which leaves this action nothing to commit. Use `render-template`
directly with `check: true` for a CI gate that verifies a committed file is current.

## Outputs

| Output             | Description                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `changed`          | `true` when the rendered content differed from what was already at `output`.                   |
| `checksum`         | SHA-256 of the rendered content, as lowercase hex.                                             |
| `output-path`      | The path written to, as given.                                                                 |
| `commit_hash`      | SHA of the created commit. Empty when nothing was committed.                                   |
| `commit_url`       | URL of the created commit. Empty when nothing was committed.                                   |
| `changes_detected` | `true` when a commit was made, `false` otherwise — never empty, even when the commit was skipped. |

`changed` describes the file on disk; `changes_detected` describes the branch. They differ in the one case worth
watching for: a render that changed the workspace file but matched what was already committed on the branch reports
`changed: true` and `changes_detected: false`.
