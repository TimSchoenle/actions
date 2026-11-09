# Generated Files Verdict

The required check of a repository's Generate workflow. It fails a pull request while any generator job failed or
left changes that are not committed yet, and it merges every pending generator patch into one
[`common/create-patch`](../create-patch) artifact, which [`common/commit-generated-files`](../commit-generated-files)
then commits as a single bot commit.

Run it in a job of its own that `needs` every generator job and has `if: always()`. The job then reports on every pull
request, including one that changed nothing a generator watches, so it can be a required status check: a workflow with
a `paths` filter, or a job that is skipped, cannot be one.

Make the verdict job the only required check of the workflow. Auto-merge then waits for the commit with the generated
files, because the head that lacks them fails the verdict and the run on the bot commit decides.

## Usage

```yaml
name: Generate

on:
  pull_request:

permissions: {}

jobs:
  docs:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      has_changes: ${{ steps.patch.outputs.has_changes }}
      artifact_name: ${{ steps.patch.outputs.artifact_name }}
    steps:
      - uses: actions/checkout@<sha> # v7
        with:
          ref: ${{ github.event.pull_request.head.sha }} # the head, not the merge commit
          persist-credentials: false
      - run: ./scripts/render-docs.sh
      - id: patch
        uses: TimSchoenle/actions/actions/common/create-patch@<sha> # tag=actions-common-create-patch-v1.1.1
        with:
          artifact_name: docs
          paths: README.md docs

  lockfile:
    # ... the same shape, with artifact_name: lockfile

  verdict:
    name: Generated Files
    needs: [docs, lockfile]
    if: always()
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: TimSchoenle/actions/actions/common/generated-files-verdict@<sha> # tag=actions-common-generated-files-verdict-v1.1.0
        with:
          needs: ${{ toJSON(needs) }}
```

The commit half is a `workflow_run` workflow on Generate, described in
[`common/commit-generated-files`](../commit-generated-files).

## Inputs

| Input             | Required | Default           | Description                                                                                        |
| ----------------- | -------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `needs`           | yes      |                   | `${{ toJSON(needs) }}` of the verdict job.                                                         |
| `changes_output`  | no       | `has_changes`     | Output each generator job sets to `true` when its patch is non-empty.                              |
| `artifact_output` | no       | `artifact_name`   | Output each generator job sets to the name of its create-patch artifact.                           |
| `artifact_name`   | no       | `generated-files` | Name of the merged patch artifact, starting with a letter or digit. Give commit-generated-files the same name.                      |
| `max_patch_bytes` | no       | `10485760`        | Largest patch, for each generator patch and for the merged one. Keep it equal on the commit side.  |

## Outputs

| Output         | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| `passed`       | `true` when no generator failed and nothing is left to commit. |
| `failed_jobs`  | Space-separated generator jobs that failed or were cancelled.  |
| `pending_jobs` | Space-separated generator jobs whose changes are not committed. |
| `has_changes`  | `true` when the merged patch is non-empty.                     |

## Permissions

| Permission              | Needed when                                                       |
| ----------------------- | ----------------------------------------------------------------- |
| `contents: read` (job)  | always, to check out the commit the merged patch is made from     |

The job holds no secret. Everything it reads came from jobs that may have run the pull request's code.

## Behaviour

- **Every job in `needs` counts.** A failed or cancelled job fails the verdict; a skipped one passes, so a generator
  may skip itself when nothing it watches changed. A job that sets no `has_changes` output is treated as having
  nothing to commit, which lets a plain check such as a linter sit in `needs` too.
- **List every job a generator depends on, directly or not.** A generator skipped because a job it needs failed
  reads as skipped, which passes. Either give generators no `needs` of their own, or put each job they depend on in
  the verdict's `needs` as well, so its failure fails the verdict.
- **No matrix generators.** A matrix job's outputs are those of whichever leg finished last, so one leg's pending
  changes can be lost. Give each variant a job of its own, or let the matrix feed one job that runs create-patch.
- **A failed generator's patch is not merged.** The verdict fails on that job until it passes; only the successful
  generators' patches are committed meanwhile.
- **A job with changes must name its artifact.** One that reports `has_changes: true` without an `artifact_name`
  output, or two jobs naming the same artifact, fail the step rather than lose a patch.
- **All patches must come from one commit.** Each generator must check out `github.event.pull_request.head.sha`. The
  default checkout of a pull request is the merge commit, and a patch made from it can never be committed to the
  branch.
- **The patches are applied in `needs` order** with `git apply`, which refuses paths outside the work tree. Two
  generators changing the same lines differently fail the step, naming the second patch.
- **The merged patch is uploaded before the verdict fails**, so the commit job finds it even though this job is red.
- **A fork's pull request is told to push the files itself.** The commit job never pushes to a fork, so the error
  there names the remedy (regenerate locally, or apply this run's merged patch) instead of a commit that will not come.
- **The merged patch is uploaded on every run**: empty when nothing is pending, and empty, from a clean checkout of
  the head, when the merge itself failed. Artifacts belong to the run, not to the attempt, so a re-run that uploaded
  nothing would leave an earlier attempt's patch for the commit job to commit.
- **No generator artifact may have the merged patch's name**, pending or not; the step fails instead.
- **Each generator patch is read with commit-patch's strict reader**: exactly `changes.patch` and `metadata.json`,
  within `max_patch_bytes`, matching the recorded size and SHA-256. Nothing in an artifact is executed.
- The composite runs its TypeScript with the `node` on the runner's `PATH`; a self-hosted runner needs Node.js 20 or
  later installed.
