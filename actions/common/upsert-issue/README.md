# Upsert Issue

Opens an issue and rewrites it on the next run, so a workflow that keeps one state card per repository,
per environment or per manifest entry leaves one issue rather than a growing pile of them.

The issue body carries a hidden marker naming the `identifier` it was opened under:

```html
<!-- timschoenle/actions:issue:repo-state:TimSchoenle-TankoVault -->
```

GitHub keeps HTML comments in an issue's raw body and hides them from the rendered view. That marker is the entire
mechanism. Nothing is carried between runs, so a re-run, a different runner or a wiped cache all find the same issue
from the body alone. Matching by marker rather than by title also means the title can change between runs without the
issue losing its identity.

## Usage

```yaml
- uses: <owner>/actions/actions/common/upsert-issue@<ref>
  with:
    token: ${{ steps.token.outputs.token }}
    identifier: repo-state:TimSchoenle-TankoVault
    title: 'Repo state: TimSchoenle/TankoVault'
    body_file: repo-state-body.md
    labels: repo-state
```

`token` needs `issues: write`.

`repository` defaults to `${{ github.repository }}`, so most callers pass nothing. Unlike a pull request reference,
`owner/repo` is always populated regardless of the triggering event.

## Inputs

| Input               | Required | Default                    | Description                                                        |
| -------------------- | -------- | --------------------------- | -------------------------------------------------------------------- |
| `token`              | yes      |                              | Token with `issues: write`.                                          |
| `identifier`         | yes      |                              | Stable key naming the issue. See below.                              |
| `title`              | yes      |                              | Issue title. Rewritten on every run that finds the issue.            |
| `body`               | no       | `''`                        | Markdown to post. Exclusive with `body_file`.                        |
| `body_file`          | no       | `''`                        | Workspace-relative file holding the markdown. Exclusive with `body`. |
| `repository`         | no       | `${{ github.repository }}`  | The repository to open or update the issue on.                      |
| `labels`             | no       | `''`                        | Multiline list of labels the issue must carry. See below.            |
| `update_existing`    | no       | `true`                      | `false` opens a new issue every run.                                 |
| `search_state`       | no       | `all`                        | `open` or `all`. Scope of the listing searched for the marker.       |
| `reopen_if_closed`   | no       | `true`                      | Reopen a closed issue carrying the marker.                           |
| `author`             | no       | `''`                        | Only match an issue opened by this login.                            |

Exactly one of `body` and `body_file` must be non-empty; setting both fails the step rather than picking one. Prefer
`body_file` for anything a build step generated — a report routed through a `${{ }}` expression has to survive the
runner's own quoting first.

### `identifier`

One to 64 characters of letters, digits, `.`, `_` and `-`, starting with a letter or digit. Anything else fails the
step: a value containing `-->` would close the marker and inject markdown after it, and a newline would break the
line-exact match that finding the issue depends on.

The key is not scoped to the workflow. Two workflows using `repo-state:TimSchoenle-TankoVault` on the same repository
will overwrite each other's issue.

### `labels`

Enforced on every run, not only at creation: a label named here and missing from the issue is added, and a label the
issue carries but this input does not name is removed. A label that does not yet exist on the repository is created
first — GitHub's issue endpoints reject an unrecognised label name rather than creating it.

A label removed by a human between runs reappears on the next one, because the desired set is this input, not the
issue's current labels. Drop a label from `labels` on the same run a person removes it by hand, or leave it out of
`labels` entirely and manage it outside this action.

## What happens on the second run

| Situation                                             | Result                                    |
| ------------------------------------------------------- | -------------------------------------------- |
| No issue carries the marker                             | A new issue. `operation: created`            |
| One does, with a different title, body or label set      | It is rewritten. `operation: updated`        |
| One does, open, with exactly this title, body and labels | Nothing is written. `operation: unchanged`   |
| One does, closed, with exactly this title, body and labels, `reopen_if_closed: true` | It is reopened, nothing else touched. `operation: reopened` |
| One did, and has since been deleted                     | A new issue. `operation: created`            |

The `unchanged` case is not only an optimisation: rewriting an issue with its own content still moves it in every
"recently updated" view.

An issue deleted between the scan and the write becomes a new issue rather than a failed step. Deleting last month's
card must not stop this month's from being posted.

A refusal to edit somebody else's issue does **not** fall back. Anyone who can open an issue on the repository can
paste the marker, and falling back there would add an issue on every run forever: the pasted issue is still the one
this action's scan finds, so the next run finds it and is refused again. The step fails once instead. Set `author` to
the login the workflow posts as to skip such an issue outright.

`listForRepo`, the endpoint this action scans, returns pull requests alongside issues — GitHub models a pull request
as an issue with a branch. A pull request is never matched, even one carrying a forged marker in its body: this
action's scope is plain issues only.

## Concurrency

Two jobs posting the same identifier at the same time both find nothing and both post. Give the caller a
`concurrency:` group if that is reachable. The duplicate is not permanent: this action's scan orders issues by when
they were last updated, so the one a later run touches stays at the front of that ordering and keeps being the one
every run after that finds. The pair does not alternate.

## Size

GitHub accepts 65,536 characters in an issue body. A longer body is cut and marked as cut, not rejected — a report
that outgrew the limit is a reason to shorten it, not to fail the build that produced it. The marker sits at the top
of the body, so it survives the cut.

## Why not the Search API

Finding the marked issue uses the plain issue listing (`GET /repos/{owner}/{repo}/issues`), paginated and scanned
client-side, not `GET /search/issues`. The search index is eventually consistent: an issue created moments ago can be
briefly invisible to it, so a workflow running on every push or every scheduled tick has a real chance of failing to
find the issue it just created and piling up duplicates.

The listing is ordered by most recently *updated*, not by creation date. This action touches its own issue on every
`created`, `updated` or `reopened` run, so a state card in routine use stays near the front of that ordering and the
scan that finds it stays cheap no matter how much other history the repository has accumulated. The cost lands on the
cases where nothing has touched the issue recently: the first run ever, or a repository where the caller has stopped
running this action against it. `search_state: all` on such a repository can take several pages to rule a match out;
`search_state: open` bounds that at whatever a well-maintained repository keeps open, at the price of never finding
(and so never reopening) a manually closed match.

## Outputs

| Output         | Description                                            |
| -------------- | -------------------------------------------------------- |
| `issue_number` | Number of the issue that was created or updated.         |
| `issue_url`    | URL of that issue.                                        |
| `operation`    | `created`, `updated`, `reopened` or `unchanged`.          |
