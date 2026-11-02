# Maintenance Trigger-coderabbit-review

Posts `@coderabbitai review` on a pull request, as a user account.

CodeRabbit does not review public repositories with fewer than 10 stars on its own. On every pull request it posts
"This repository does not receive automatic reviews because it has fewer than 10 stars." and reports its check as
skipped, whatever `reviews.auto_review` says in `.coderabbit.yaml`. It still answers the review command, but only from
a user. The same comment from `github-actions[bot]` or from a GitHub App gets no reply and starts no review. A
comment from the repository owner gets "Review triggered" within seconds.

This action posts that comment, so reviews start without anyone typing it.

## Usage

```yaml
name: CodeRabbit Review

on:
  pull_request:
    types: [opened, reopened, ready_for_review, synchronize]

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions: {}

jobs:
  trigger:
    name: Trigger CodeRabbit Review
    # A pull request from a fork runs without secrets, so the token would be empty.
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - uses: TimSchoenle/actions/actions/maintenance/trigger-coderabbit-review@<sha> # tag=actions-maintenance-trigger-coderabbit-review-v1.0.0
        with:
          token: ${{ secrets.CODERABBIT_TRIGGER_TOKEN }}
```

`synchronize` makes each push ask for an incremental review of the new commits, which is what automatic review did.
Each push therefore adds one comment to the pull request. Drop it to review only when the pull request opens or
leaves draft, and start later reviews by hand.

The job needs no `permissions`: the comment is posted with `token`, not `github.token`.

### The token

A fine-grained personal access token of the account that should appear as the author of the comment:

- **Resource owner:** the account that owns the repositories.
- **Repository access:** only the repositories that run this workflow.
- **Permissions:** Pull requests, read and write. Nothing else.

Store it as a repository secret, `CODERABBIT_TRIGGER_TOKEN` in the example. GitHub does not hand secrets to a run
started from a fork, so a fork cannot use it, and `reject_forks` skips a fork pull request even when the job is
started some other way.

Before reading the pull request, the action calls `GET /user` with the token and fails unless the token authenticates
as an account of type `User`. `github.token` and app installation tokens cannot call that endpoint, so passing one
fails the step on every run instead of posting comments that CodeRabbit ignores. A token GitHub rejects with 401, which is what an expired fine-grained token gets, fails
with its own message, since it needs replacing rather than a different kind of token.

## Inputs

| Input          | Required | Default                                     | Description                                                                                     |
| -------------- | -------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `token`        | yes      |                                             | Personal access token of a user, with Pull requests: write.                                     |
| `pr_url`       | no       | `${{ github.event.pull_request.html_url }}` | Pull request to comment on.                                                                     |
| `command`      | no       | `review`                                    | `review` for the commits CodeRabbit has not reviewed yet, `full review` to review every file.   |
| `skip_drafts`  | no       | `true`                                      | Skip a draft. `ready_for_review` then triggers the review.                                      |
| `skip_bots`    | no       | `true`                                      | Skip a pull request whose author GitHub reports as type `Bot`, such as Renovate.                 |
| `skip_authors` | no       | `''`                                        | Logins to skip, separated by commas or newlines, case-insensitive. Bots use their full login, e.g. `renovate[bot]`. |
| `reject_forks` | no       | `true`                                      | Skip a pull request whose head branch lives in another repository.                              |

## Outputs

| Output        | Description                                                                         |
| ------------- | ----------------------------------------------------------------------------------- |
| `triggered`   | `true` when the comment was posted, `false` when the pull request was skipped.       |
| `skip_reason` | `closed`, `draft`, `fork`, `bot-author` or `skipped-author`. Empty when posted.      |
| `comment_url` | URL of the posted comment. Empty when skipped.                                       |

A skipped pull request is not a failure. The rules are checked in the order of the `skip_reason` list above, and the
first one that applies is reported.

## What it refuses

The step fails without posting anything when:

- the token does not authenticate as a user account;
- `command` is anything other than `review` or `full review`. The comment body is built from it, so a value with a
  second line could otherwise post a second CodeRabbit command;
- `pr_url` does not contain `owner/repo/pull/<number>`;
- GitHub returns the pull request without an author or without its head or base repository. The fork and bot checks
  would otherwise pass by default.
