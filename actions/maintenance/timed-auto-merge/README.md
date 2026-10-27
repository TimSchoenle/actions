# Timed Auto-merge

Approves and enables auto-merge on open pull requests whose head branch matches a pattern, that have been open for
at least `time_elapsed`, and whose every commit is signed and authored only by `trusted_authors`. A pull request that is
already mergeable, so GitHub refuses auto-merge for it, is merged directly instead. It is meant for a
scheduled job that lets release-please or Renovate pull requests merge themselves after a waiting period in which a
human can still intervene.

## Usage

```yaml
name: Timed Auto-merge

on:
  schedule:
    - cron: '17 * * * *'
  workflow_dispatch:
    inputs:
      time_elapsed:
        description: 'How long a pull request must have been open (e.g. "24h", "2d").'
        required: false
        default: '1d'

concurrency:
  group: ${{ github.workflow }}
  cancel-in-progress: false

permissions: {}

jobs:
  timed-auto-merge:
    name: Timed Auto-merge
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - name: Generate Bot Token
        id: token
        uses: actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0
        with:
          app-id: ${{ secrets.AUTO_MERGE_APP_ID }}
          private-key: ${{ secrets.AUTO_MERGE_PRIVATE_KEY }}
          permission-contents: write
          permission-pull-requests: write

      - name: Approve and Auto-merge
        uses: TimSchoenle/actions/actions/maintenance/timed-auto-merge@<release-sha> # tag=actions-maintenance-timed-auto-merge-v<version>
        with:
          token: ${{ steps.token.outputs.token }}
          # Database ID of the bot account that opens the release pull requests.
          trusted_authors: '123456789'
          branch_pattern: 'release-please--branches--%'
          time_elapsed: ${{ inputs.time_elapsed || '1d' }}
          minimum_age: '1h'
          merge_method: squash
```

The root [README](../../../README.md#maintenance) lists the commit SHA and tag of the current release for the `uses:`
line.

The job needs no `GITHUB_TOKEN` permissions: every call is made with the App token. That token needs
`pull-requests: write` to review and `contents: write` to enable auto-merge, and nothing else. It must belong to an
identity that did not open the pull requests, because GitHub rejects a review from the pull request's author. The
App that release-please or Renovate runs as cannot approve its own pull requests, so use a second App.

`time_elapsed` can be wired to a `workflow_dispatch` input, as above. `minimum_age` should not be: it is the floor that
stops a dispatch with `0s` from merging a pull request the moment it is opened, and it only does that if changing it
takes a commit to the workflow file.

## Inputs

| Input             | Required | Default                       | Description                                                                         |
| ----------------- | -------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| `token`           | yes      |                               | Token with `contents: write` and `pull-requests: write`, not the pull request author. |
| `trusted_authors` | yes      |                               | Comma-separated GitHub user database IDs. See [Commit verification](#commit-verification). |
| `branch_pattern`  | no       | `release-please--branches--%` | Pattern the head branch must match. See [Branch pattern](#branch-pattern).           |
| `pattern_mode`    | no       | `legacy`                      | `legacy` or `regex`.                                                                |
| `time_elapsed`    | no       | `1d`                          | How long a pull request must have been open.                                        |
| `minimum_age`     | no       | `1h`                          | Floor for `time_elapsed`. A lower `time_elapsed` fails the step.                    |
| `merge_method`    | no       | `squash`                      | `merge`, `squash` or `rebase`.                                                      |
| `repository`      | no       | `${{ github.repository }}`    | Repository to process, as `owner/repo`.                                             |
| `approve_message` | no       | see `action.yaml`             | Body of the approving review. Must not be empty.                                    |
| `fail_on_error`   | no       | `true`                        | Fail the step when an API call for any pull request failed.                         |

`time_elapsed` and `minimum_age` are a whole number followed by `s`, `m`, `h` or `d`: `90m`, `24h`, `7d`. Nothing else
is accepted, including `1 day`, `1d12h` or `01h`.

Every input is validated before the first API call, so a misconfigured workflow fails without touching a pull request.

## Outputs

| Output     | Example                                   | Description                                                    |
| ---------- | ----------------------------------------- | -------------------------------------------------------------- |
| `approved` | `[12,15]`                                 | Pull requests approved and set to auto-merge, or merged, on this run. |
| `skipped`  | `[{"number":13,"reason":"too-young"}]`    | Matching pull requests left alone, with the reason.            |
| `failed`   | `[{"number":14,"message":"..."}]`         | Pull requests where an API call failed, with the error.        |

The step summary has one row per matching pull request with the same information and a longer explanation of each
skip, such as which commit failed verification and why.

## What happens to each pull request

Open pull requests are listed across all pages, oldest first. Those whose head branch does not match `branch_pattern`
are not mentioned anywhere. Each one that matches is processed in turn:

| Check                                                           | If it fails                  |
| --------------------------------------------------------------- | ---------------------------- |
| The head branch is in the repository itself, not a fork         | skipped, `fork`              |
| The pull request is not a draft                                 | skipped, `draft`             |
| It was opened at least `time_elapsed` ago                       | skipped, `too-young`         |
| Its commits were read at the head SHA from the listing          | skipped, `head-moved`        |
| It has commits, and every commit passes verification            | skipped, `commits-unverified` |

When every check passes, the pull request is approved with the review attached to that head SHA (`commit_id`), and
auto-merge is enabled through the GraphQL `enablePullRequestAutoMerge` mutation with the same SHA as
`expectedHeadOid`. If someone pushes to the branch after the commits were verified, GitHub refuses the auto-merge
request, and the pull request is reported under `failed`. The next run verifies the new head.

GitHub also refuses auto-merge when nothing is left to wait for, because the pull request is already mergeable. So
whenever enabling auto-merge fails, the action reads the merge state. If it is `CLEAN`, `HAS_HOOKS` or `UNSTABLE` at
the verified head, the pull request is merged directly with the same SHA as `sha`, as `gh pr merge --auto` does. The
base branch's rules still apply to that merge. In any other state, or when the state cannot be read, the original
error is reported under `failed`.

A skip is not an error. The step fails only when an API call failed, after every matching pull request has been
processed, and only while `fail_on_error` is `true`. Listing the pull requests failing, or the branch pattern
exceeding its time budget, fails the step at once, since then no pull request can be judged.

Requests go through the shared Octokit client from `packages/ts-util`, which retries a request GitHub refused for rate
limiting and waits as long as GitHub says to, within a bounded budget. Pull requests are processed one after another so
that one run does not spend the installation's rate limit in a burst.

### After auto-merge is enabled

GitHub keeps auto-merge enabled when a user with write access pushes to the branch. For the review this action left
to stop counting on a later push, enable **Dismiss stale pull request approvals when new commits are pushed** in the
branch protection rule or ruleset of the base branch, together with a required approval. The pull request then waits
until the next run has verified the new head and approved it again.

## Branch pattern

In `legacy` mode, the default, every `%` in the pattern stands for any run of characters, and the pattern is anchored
at the start of the branch name. `release-please--branches--%` matches `release-please--branches--main` but not
`feature/release-please--branches--main`. The anchor applies to every alternative of a top-level `|`, so
`release/%|hotfix/%` matches `hotfix/x` but not `evil/hotfix/x`. The rest of the pattern is a POSIX extended regular
expression, as in this pattern from a Renovate setup:

```text
(chore/helm/auto-update/|renovate/([^m]|m[^a]|ma[^j]|maj[^o]|majo[^r]))%
```

A literal `%` cannot be written in `legacy` mode. The pattern must also be a valid regular expression on its own,
with balanced parentheses, before it is anchored: `x)|(y` is rejected, because it would close the anchoring group early
and leave `y` free to match anywhere. Escaped or bracketed parentheses such as `\)` and `[)]` are fine.

In `regex` mode the pattern is a POSIX extended regular expression used as is, unanchored, the same as the
`branch_pattern` of `auto-approve-pr`. Write `^` and `$` to anchor it.

Both modes translate POSIX bracket classes such as `[[:digit:]]`, and both evaluate every branch name under one shared
time budget. Branch names can be chosen by anyone who can push a branch, so a pattern prone to catastrophic
backtracking fails the step instead of holding the runner.

An empty pattern is rejected: it would match every open pull request.

## Commit verification

The commits are fetched with `fetchPullRequestCommits` and checked with `verifyCommits` from `packages/ts-util`, the
same code `verify-commit-authors` and `auto-approve-pr` use. Every author of every commit, co-authors included, must be
one of `trusted_authors`, and every commit must carry a signature GitHub reports as valid. A commit signed with a
personal key must also have a committer and a key owner in `trusted_authors`. A commit GitHub signed itself skips
those two checks, because GitHub is its committer and resolves to no account. A commit with an author that is not
linked to a GitHub account fails. See [Accepted Risks](../../../SECURITY.md#accepted-risks) for what that exception
allows.

`trusted_authors` takes database IDs rather than logins, because a login can be renamed and then registered by someone
else. Look one up with `gh api users/<login> --jq .id`; for an App's bot account, `gh api 'users/<slug>[bot]' --jq .id`.

Every page of the commit list is read at one head SHA, and that head must be among the commits. A pull request whose
commits were read at a different head than the listing reported is skipped as `head-moved`. A commit list whose head
changes between pages, that does not contain its head, or whose length disagrees with the commit count GitHub reports
is reported under `failed`.
