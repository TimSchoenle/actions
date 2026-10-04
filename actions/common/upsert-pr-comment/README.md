# Upsert PR Comment

Posts a comment on a pull request and rewrites it on the next run, so a workflow that reports something after every
build leaves one comment rather than a column of them.

The comment carries a hidden marker naming the `identifier` it was posted under:

```html
<!-- timschoenle/actions:pr-comment:docker-image-size -->
```

GitHub keeps HTML comments in a comment's raw body and hides them from the rendered view. That marker is the entire
mechanism — nothing is carried between runs, so a re-run, a different runner or a wiped cache all find the same comment
from the body alone.

## Usage

```yaml
- id: size
  run: |
    set -euo pipefail
    docker image inspect api:${{ github.sha }} --format '{{ .Size }}' > image-size.txt

- uses: <owner>/actions/actions/common/upsert-pr-comment@<ref>
  with:
    token: ${{ steps.token.outputs.token }}
    identifier: docker-image-size
    body: |
      **Image size:** ${{ steps.size.outputs.bytes }} bytes
```

`token` needs `pull-requests: write`. Comments on a pull request are governed by that permission, not by `issues`, even
though they are posted through the issues endpoint — GitHub models a pull request as an issue with a branch.

`pr_url` defaults to `${{ github.event.pull_request.html_url }}`, so a `pull_request`-triggered workflow passes nothing.
Any other trigger has to supply it.

## Inputs

| Input             | Required | Default                                          | Description                                                     |
| ----------------- | -------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `token`           | yes      |                                                  | Token with `pull-requests: write`.                              |
| `identifier`      | yes      |                                                  | Stable key naming the comment. See below.                       |
| `body`            | no       | `''`                                             | Markdown to post.                                               |
| `body_file`       | no       | `''`                                             | Workspace-relative file holding the markdown.                   |
| `body_lines`      | no       | `''`                                             | Lines to post; blank ones are dropped. See below.               |
| `header`          | no       | `''`                                             | Markdown above the surviving `body_lines`.                      |
| `footer`          | no       | `''`                                             | Markdown below the surviving `body_lines`.                      |
| `pr_url`          | no       | `${{ github.event.pull_request.html_url }}`      | The pull request to comment on.                                 |
| `update_existing` | no       | `true`                                           | `false` posts a new comment every run.                          |
| `author`          | no       | `''`                                             | Only update a comment posted by this login.                     |

Exactly one of `body`, `body_file` and `body_lines` must be non-empty; setting two fails the step rather than picking
one. Prefer `body_file` for anything a build step generated. A report routed through a `${{ }}` expression has to
survive the runner's own quoting first.

`header` and `footer` are only valid with `body_lines`. Setting either alongside `body` or `body_file` fails the step,
because ignoring it would post a comment missing text the workflow asked for.

A body carrying a marker of this action on a line of its own fails the step, whichever input it came from. A run finds
its comment by a marker on any line, so a planted `<!-- timschoenle/actions:pr-comment:other -->` would let the next
run for `other` find this comment and overwrite it. A marker inside a line of prose is not matched and is allowed.

An empty `body` or `body_file` fails the step. The action cannot tell a generator that broke from one with nothing to
report, so only `body_lines` can skip.

### `body_lines`

A comment assembled from a fixed list, where each line is gated by an earlier step's output. The runner evaluates every
`${{ }}` before the action starts, so the action sees lines, some of them empty:

```yaml
- name: Comment on PR
  if: github.event_name == 'pull_request'
  uses: <owner>/actions/actions/common/upsert-pr-comment@<ref>
  with:
    token: ${{ steps.token.outputs.token }}
    identifier: render-generated-files
    header: 'Re-rendered from the configuration types in `crates/config`:'
    body_lines: |
      ${{ steps.readme.outputs.changes_detected == 'true' && '- `README.md`, from `.github/templates/README.md.hbs`' || '' }}
      ${{ steps.example-config.outputs.changes_detected == 'true' && '- `config.example.toml`, from `.github/templates/config.example.toml.hbs`' || '' }}
```

A line that is empty or whitespace after trimming is dropped. The rest are kept verbatim and in input order, so an
indented sub-bullet stays nested. `header`, the surviving lines and `footer` are joined with one blank line between
each. CRLF line endings split the same as LF.

When no line survives, the action logs `Nothing to report; no comment posted.`, sets `operation` to `skipped` and makes
no API call. A comment from an earlier run is left as it is: it described that run's push and is still true of it. The
skip happens before `pr_url` is read, so it also passes on a `push` event, where `pr_url` is empty. `header` and
`footer` alone never make a comment.

Write `body_lines` as a block scalar (`|`). A single-line value whose one expression evaluates to `''` arrives as an
empty input, which reads as unset and fails the step instead of skipping.

`cond && 'text' || ''` returns `''` whenever the middle value is falsy, so it only works when that value is non-empty
literal text. Every line in the example above is.

`body_lines` is not escaped. Interpolate only literal text and step outputs the workflow itself computed. A value a
contributor controls, such as a branch name or a pull request title, turns the line into a script-injection path. Write
it to a file and pass that as `body_file`.

### `identifier`

One to 64 characters of letters, digits, `.`, `_` and `-`, starting with a letter or digit. Anything else fails the
step: a value containing `-->` would close the marker and inject markdown after it, and a newline would break the
line-exact match that finding the comment depends on.

The key is not scoped to the workflow. Two workflows using `docker-image-size` on the same pull request will overwrite
each other's comment.

## What happens on the second run

| Situation                                     | Result                                       |
| --------------------------------------------- | -------------------------------------------- |
| No comment carries the marker                  | A new comment. `operation: created`           |
| One does, with a different body                | It is rewritten. `operation: updated`         |
| One does, with exactly this body               | Nothing is written. `operation: unchanged`    |
| One did, and has since been deleted            | A new comment. `operation: created`           |
| No `body_lines` line survived                  | Nothing is read or written. `operation: skipped` |

The `unchanged` case is not only an optimisation: rewriting a comment with its own text still moves it in every
"recently updated" view.

A comment that was deleted between the scan and the write becomes a new comment rather than a failed step — a reviewer
tidying up last week's report must not stop this week's from being posted.

A refusal to edit somebody else's comment does **not** fall back. Anyone who can comment on the pull request can paste
the marker, and falling back there would add a comment on every run forever: the pasted comment is still the oldest one
carrying the marker, so the next run finds it and is refused again. The step fails once instead. Set `author` to the
login the workflow posts as to skip such a comment outright.

## Concurrency

Two jobs posting the same identifier at the same time both find nothing and both post. Give the caller a `concurrency:`
group if that is reachable. The duplicate is not permanent: the oldest comment carrying the marker is the one every
later run updates, so the pair does not alternate.

## Size

GitHub accepts 65,536 characters in a comment. A longer body is cut and marked as cut, not rejected — a size report that
outgrew the limit is a reason to shorten the report, not to fail the build that produced it. The marker sits at the top
of the body, so it survives the cut.

## Outputs

| Output        | Description                                            |
| ------------- | ------------------------------------------------------ |
| `comment_id`  | ID of the comment that was created or updated. Empty when skipped. |
| `comment_url` | URL of that comment. Empty when skipped.               |
| `operation`   | `created`, `updated`, `unchanged` or `skipped`.        |
