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
| `body`            | no       | `''`                                             | Markdown to post. Exclusive with `body_file`.                   |
| `body_file`       | no       | `''`                                             | Workspace-relative file holding the markdown. Exclusive with `body`. |
| `pr_url`          | no       | `${{ github.event.pull_request.html_url }}`      | The pull request to comment on.                                 |
| `update_existing` | no       | `true`                                           | `false` posts a new comment every run.                          |
| `author`          | no       | `''`                                             | Only update a comment posted by this login.                     |

Exactly one of `body` and `body_file` must be non-empty; setting both fails the step rather than picking one. Prefer
`body_file` for anything a build step generated — a report routed through a `${{ }}` expression has to survive the
runner's own quoting first.

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
| `comment_id`  | ID of the comment that was created or updated.         |
| `comment_url` | URL of that comment.                                   |
| `operation`   | `created`, `updated` or `unchanged`.                   |
