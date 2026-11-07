# Find Patch

Reports whether a workflow run uploaded a non-empty [`common/create-patch`](../create-patch) artifact, without holding
any secret. A `workflow_run` workflow runs it in a job of its own ahead of the job that mints the write token for
[`common/commit-patch`](../commit-patch), and skips that job when there is nothing to commit: the producing job was
skipped, its patch is empty, or the patch was made from a commit the branch has since moved past.

The artifact is validated exactly as `commit-patch` validates it. A malformed one fails the step instead of reading as
"nothing to commit", so a broken producer shows up as a red run, not as a pull request that silently never gets its
commit.

## Usage

```yaml
name: Auto Format Commit

on:
  workflow_run:
    workflows: ['Auto Format'] # the name: of the pull_request workflow
    types: [completed]

permissions: {}

jobs:
  # Holds no secret and no environment.
  find-patch:
    if: >-
      (github.event.workflow_run.conclusion == 'success' || github.event.workflow_run.conclusion == 'failure') &&
      github.event.workflow_run.event == 'pull_request' &&
      github.event.workflow_run.head_repository.full_name == github.repository &&
      github.event.workflow_run.head_branch != github.event.repository.default_branch
    runs-on: ubuntu-latest
    permissions:
      actions: read # to list and download the pull_request run's artifacts
    outputs:
      has_changes: ${{ steps.patch.outputs.has_changes }}
    steps:
      - id: patch
        uses: TimSchoenle/actions/actions/common/find-patch@<sha> # tag=actions-common-find-patch-v1.0.0
        with:
          run_id: ${{ github.event.workflow_run.id }}
          artifact_name: format-patch
          expected_head_sha: ${{ github.event.workflow_run.head_sha }}

  commit:
    needs: find-patch
    if: needs.find-patch.outputs.has_changes == 'true'
    runs-on: ubuntu-latest
    environment: ci
    permissions:
      actions: read
      contents: read
    steps:
      # checkout, create-github-app-token and commit-patch, as in the commit-patch README
```

Accepting a `failure` conclusion lets a producer fail its own check while its patch is still uncommitted, so the head
it ran on cannot merge before the bot commit lands, and still have that patch committed.

## Inputs

| Input               | Required | Default                   | Description                                                                         |
| ------------------- | -------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `artifact_name`     | yes      |                           | The `artifact_name` given to `create-patch`.                                        |
| `run_id`            | no       |                           | Run of this repository to look in, such as `github.event.workflow_run.id`. Empty means this run. |
| `expected_head_sha` | no       |                           | Commit the patch must have been made from. Empty accepts any.                       |
| `max_patch_bytes`   | no       | `10485760`                | Largest patch accepted. Keep it equal on create-patch and commit-patch.             |
| `token`             | no       | `${{ github.token }}`     | Token that may read the run's artifacts.                                            |

## Outputs

| Output        | Description                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `has_changes` | `true` when the run holds a non-empty patch made from `expected_head_sha`; `false` in every other case.      |
| `outcome`     | `changes`; `branch_moved` for a patch made from another commit; `no_changes` for an empty patch; `missing` when the run holds no unexpired artifact of that name. |
| `found`       | `true` when the run holds an unexpired artifact of that name.                                                |
| `base_sha`    | The commit the patch was made from, when the artifact was found.                                             |
| `directory`   | Directory holding the validated `changes.patch` and `metadata.json`, set once validation passed.             |

`directory` is there for reading which paths the patch touches, to word a pull request comment for instance. Treat
the files as untrusted data, as the job that wrote them ran pull request code: never execute or `source` anything
from them.

## Permissions

| Permission            | Needed when                                         |
| --------------------- | --------------------------------------------------- |
| `actions: read` (job) | always, to list and download the run's artifacts    |

## Behaviour

- **A missing or expired artifact is `missing`, not an error.** `create-patch` uploads even an empty patch, so no
  artifact means the job that makes it did not run. An artifact past its retention can no longer be downloaded, and a
  run that old has nothing left to commit.
- **A run that does not exist fails the step.** A mistyped `run_id`, or a token without `actions: read`, would
  otherwise skip every commit without a word.
- **Several unexpired artifacts of the same name, from re-run attempts, resolve to the newest.** download-artifact
  fetches the one with the highest ID, so that is the one inspected; the step logs a warning naming them all.
- **The outcome is the one `commit-patch` would end with.** A patch made from another commit than
  `expected_head_sha` is `branch_moved`, empty or not, reported with a notice; otherwise an empty patch is
  `no_changes`.
- **Only the two files are read.** The artifact must hold exactly `changes.patch` and `metadata.json`, both regular
  files opened without following links, with the patch within `max_patch_bytes` and matching the size and SHA-256
  recorded beside it. Nothing in it is executed.
- The composite runs its TypeScript with the `node` on the runner's `PATH`; a self-hosted runner needs Node.js 20 or
  later installed.
