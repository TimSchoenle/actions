# Maintenance Wipe-cache

Deletes every GitHub Actions cache entry recorded against one branch, through the REST API
(`GET /repos/{owner}/{repo}/actions/caches?ref=` and `DELETE /repos/{owner}/{repo}/actions/caches/{cache_id}`).

GitHub keeps a deleted branch's caches until they go seven days without access, and they count against the
repository's cache storage limit the whole time. Wiping them when the branch is deleted frees that space for the branches
still in use.

It replaces the reusable workflow `workflows/maintenance/wipe-cache`, which shelled out to the `gh-actions-cache`
extension. That extension is archived and was installed unpinned on every run.

## Usage

```yaml
name: Cleanup Branch Caches

on:
  delete:

permissions: {}

jobs:
  wipe-cache:
    name: Wipe Cache
    if: github.event.ref_type == 'branch'
    runs-on: ubuntu-latest
    permissions:
      actions: write # to list and delete caches
    steps:
      - uses: TimSchoenle/actions/actions/maintenance/wipe-cache@<sha> # tag=actions-maintenance-wipe-cache-v1.0.0
        with:
          token: ${{ github.token }}
```

`github.token` with `actions: write` is all it needs: listing caches takes `actions: read`, deleting one takes
`actions: write`, and the default-branch check reads repository metadata, which every token can.

On a `delete` event, `github.event.ref` is the deleted branch's short name and `github.ref` is the default branch, which
is why `branch` defaults to the former. The job-level `if:` keeps the job from starting for a deleted tag. The action
also skips a tag deletion on its own, with a notice, in case the `if:` is left out.

### Another branch, or a dry run first

```yaml
- uses: TimSchoenle/actions/actions/maintenance/wipe-cache@<sha> # tag=actions-maintenance-wipe-cache-v1.0.0
  with:
    token: ${{ github.token }}
    branch: ${{ inputs.branch }}
    dry_run: true
```

## Inputs

| Input                  | Required | Default                    | Description                                                                 |
| ---------------------- | -------- | -------------------------- | --------------------------------------------------------------------------- |
| `token`                | yes      |                            | Token with `actions: write`.                                                |
| `repository`           | no       | `${{ github.repository }}` | Repository whose caches are deleted, as `owner/repo`.                       |
| `branch`               | no       | `${{ github.event.ref }}`  | Branch to wipe, as `feature/x` or `refs/heads/feature/x`.                   |
| `allow_default_branch` | no       | `false`                    | Allow wiping the repository default branch.                                 |
| `dry_run`              | no       | `false`                    | List the entries that would be deleted and delete none.                     |
| `fail_on_error`        | no       | `true`                     | Fail the step when an entry could not be deleted. `false` warns instead.    |

## Outputs

| Output          | Description                                                                 |
| --------------- | --------------------------------------------------------------------------- |
| `matched_count` | Distinct cache entries found for the branch, across every listing round.    |
| `deleted_count` | Entries this run deleted. Always `0` on a dry run.                          |
| `failed_count`  | Entries that could not be deleted.                                          |

The same counts, the space freed and every entry that survived are written to the job summary.

## What it refuses

The step fails before listing anything when:

- `branch` is empty. A workflow triggered by anything but `delete` has no `github.event.ref`, and wiping "no branch"
  is a wiring mistake, not a no-op.
- `branch` is a full ref outside `refs/heads/`, such as `refs/tags/v1` or `refs/pull/12/merge`. Prefixing it with
  `refs/heads/` would target a branch nobody named.
- `branch` is not a valid git branch name, per the rules of `git check-ref-format`.
- `branch` is the repository default branch and `allow_default_branch` is not `true`. Every other branch restores from
  the default branch's caches, so wiping them slows every job until they are rebuilt. A `delete` event cannot name
  the default branch, so reaching this means `branch` was wired to the wrong context.

Branch names are compared exactly. Git treats `Main` and `main` as different branches.

## How the wipe runs

Each round lists every page of entries for the branch, then deletes each one by id. Deleting while paging would shift
later pages under the cursor and skip entries. The next round lists again, which also picks up entries a job still
running on the branch saved in the meantime. The run stops when:

- a listing comes back empty;
- a round deletes nothing because every delete failed, since another round would fail the same way;
- every entry in a round answered 404, meaning something else removed them first;
- ten rounds have each deleted something and entries are still being listed. This logs a warning and does not fail.

An entry the API returns for a ref other than the requested one is never deleted, in case the `ref` filter is ever
ignored. A failed delete is retried in the next round, and only an entry whose last attempt failed counts towards
`failed_count`. A 404 on delete counts as neither deleted nor failed.

Listing or default-branch lookup failures, such as a token without `actions: read`, fail the step immediately.
