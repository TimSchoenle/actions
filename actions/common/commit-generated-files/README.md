# Commit Generated Files

The commit half of a repository's Generate workflow. From a `workflow_run` job, it commits the merged patch that
[`common/generated-files-verdict`](../generated-files-verdict) uploaded to the pull request branch, as a GitHub App.

A `workflow_run` job runs the default branch's copy of the workflow, so a pull request cannot rewrite the job that
holds the App key. The key is used only when there is something to commit: [`common/find-patch`](../find-patch)
checks the artifact first, without any secret, and the token is minted afterwards with `contents: write` only.

## Usage

```yaml
name: Generate Commit

on:
  workflow_run:
    workflows: [Generate] # the name: of the pull_request workflow
    types: [completed]

permissions: {}

jobs:
  commit:
    runs-on: ubuntu-latest
    environment: ci
    permissions:
      actions: read # to list and download the pull_request run's artifacts
      contents: read
    steps:
      - uses: TimSchoenle/actions/actions/common/commit-generated-files@<sha> # tag=actions-common-commit-generated-files-v1.1.0
        with:
          client_id: ${{ vars.BOT_CLIENT_ID }}
          private_key: ${{ secrets.BOT_PRIVATE_KEY }}
          allowed_paths: |
            README.md
            docs/**
            Cargo.lock
```

`allowed_paths` must cover every generator's paths: a merged patch touching anything else fails the commit.

## Inputs

| Input             | Required | Default                         | Description                                                                         |
| ----------------- | -------- | ------------------------------- | ----------------------------------------------------------------------------------- |
| `client_id`       | yes      |                                 | Client ID of the GitHub App. Its installation needs `contents: write`.              |
| `private_key`     | yes      |                                 | Private key of that GitHub App.                                                     |
| `allowed_paths`   | yes      |                                 | Paths and globs the merged patch may change, as `common/commit-patch` takes them.   |
| `commit_message`  | no       | `chore: update generated files` | Message of the commit.                                                              |
| `artifact_name`   | no       | `generated-files`               | Name of the merged patch artifact, as given to generated-files-verdict.             |
| `max_patch_bytes` | no       | `10485760`                      | Largest patch. Keep it equal to the verdict side.                                   |

## Outputs

| Output       | Description                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `outcome`    | `committed`, `branch_moved`, `no_changes` or `missing`, as commit-patch and find-patch report them; `skipped` when the run is not one to commit for; `failed` when the commit step failed. |
| `commit_sha` | SHA of the commit made, when one was.                                                                               |
| `commit_url` | URL of the commit made, when one was.                                                                               |

## Permissions

| Permission             | Needed when                                                   |
| ---------------------- | ------------------------------------------------------------- |
| `actions: read` (job)  | always, to list and download the pull_request run's artifacts |
| `contents: read` (job) | when there is something to commit, to check out the head      |
| App `contents: write`  | when there is something to commit                             |

## Behaviour

- **Only from `workflow_run`.** Started by any other event, the step fails before it looks for a patch.
- **Skipped, without touching the key,** when the triggering run was not a pull request's, came from a fork, ran on
  the default branch, or ended other than `success` or `failure` (cancelled, skipped, timed out). The filter is
  `check-event.sh`, which the verify workflow drives through every case. A failed run still commits: the verdict job fails
  whenever there is something to commit.
- **One commit per push.** The verdict already merged every generator's patch, so the pull request's checks run once
  more, on the bot commit, and the verdict there decides.
- **A branch that moved on is not written to.** commit-patch checks the branch against the head the run checked out
  and ends with `branch_moved`; the run for the new head generates again.
- Commits made with the App token trigger workflows, unlike commits made with `GITHUB_TOKEN`, which is what lets the
  checks run on the bot commit.
- **Dependabot pull requests.** GitHub runs a `workflow_run` started by a Dependabot run with Dependabot's secrets
  only, so the App key has to be a Dependabot secret too for those pull requests. Renovate pull requests need nothing
  extra.
