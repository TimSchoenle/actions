# Maintenance Auto-rebase

Keeps labelled pull requests current with their base branch. For every open pull request carrying `label`, it calls
`PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch`, the API behind the "Update branch" button.

Despite the name, that API merges the base branch into the head branch; it does not rebase. The name is kept from the
reusable workflow `workflows/maintenance/auto-rebase` this action replaces, which called the same API.

## Usage

```yaml
name: Auto Rebase Dependencies

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}
  cancel-in-progress: true

permissions: {}

jobs:
  auto-rebase:
    name: Auto Rebase
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - name: Generate Token
        id: token
        uses: actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0
        with:
          app-id: ${{ secrets.MAINTENANCE_APP_ID }}
          private-key: ${{ secrets.MAINTENANCE_PRIVATE_KEY }}
          permission-contents: write
          permission-pull-requests: write

      - uses: TimSchoenle/actions/actions/maintenance/auto-rebase@<sha> # tag=actions-maintenance-auto-rebase-v1.0.0
        with:
          token: ${{ steps.token.outputs.token }}
          label: dependencies
```

The token needs `contents: write` to push the merge commit and `pull-requests: write` to request it. Use an app token
rather than `github.token`: GitHub does not start workflows for commits pushed with `github.token`, so the updated pull
requests would sit without CI.

## Inputs

| Input           | Required | Default                    | Description                                                                 |
| --------------- | -------- | -------------------------- | --------------------------------------------------------------------------- |
| `token`         | yes      |                            | Token with `contents: write` and `pull-requests: write`.                    |
| `label`         | yes      |                            | Label marking the pull requests to update.                                  |
| `repository`    | no       | `${{ github.repository }}` | Repository whose pull requests are updated, as `owner/repo`.                |
| `skip_drafts`   | no       | `false`                    | Leave draft pull requests alone.                                            |
| `fail_on_error` | no       | `true`                     | Fail the step on an unexpected error. `false` warns instead. See below.     |

`label` is compared case-insensitively, as GitHub compares label names: a repository cannot hold both `Dependencies`
and `dependencies`.

## Outputs

Each is a JSON array of pull request numbers, for `fromJSON()` in a later step.

| Output    | Description                                                                         |
| --------- | ----------------------------------------------------------------------------------- |
| `updated` | Pull requests an update was requested for.                                          |
| `skipped` | Pull requests left alone. The job log and summary give the reason for each.         |
| `failed`  | Pull requests whose update GitHub rejected or that failed with an unexpected error. |

## What happens to each pull request

The list of open pull requests is a snapshot, so each labelled one is read again just before its turn and skipped when:

| Reason                    | Condition                                                       |
| ------------------------- | --------------------------------------------------------------- |
| `not-open`                | It was closed, merged or deleted since the list was read.       |
| `label-removed`           | The label came off since the list was read.                     |
| `draft`                   | It is a draft and `skip_drafts` is `true`.                      |
| `head-repository-deleted` | Its head is on a fork that no longer exists.                    |
| `fork-not-writable`       | Its head is on a fork that does not allow maintainer edits.     |
| `up-to-date`              | Its head already contains every commit of the base branch.      |

Otherwise the update is requested with `expected_head_sha` set to the head commit that second read returned. A push
that lands between the read and the request makes GitHub reject the update, so it never merges over a commit nobody
looked at.

The `up-to-date` check compares the base branch with the head commit. When that comparison fails, the update is
requested anyway and GitHub decides.

## Failures

GitHub answers 422 when it will not apply an update: the branches conflict, the head moved, or there is nothing to
merge. Those are logged as warnings and listed in `failed`, and never fail the step. A conflicting pull request needs a
person, and a red maintenance job would not tell them anything the pull request does not.

Any other failure on a pull request, such as a 403 from a token without write access, is logged as an error and listed
in `failed`. The remaining pull requests are still processed, then the step fails unless `fail_on_error` is `false`.
Failing to list the pull requests at all fails the step immediately.

Pull requests are updated one after another. GitHub merges in the background after answering `202 Accepted`, so the
new head commit appears shortly after the step has finished.
