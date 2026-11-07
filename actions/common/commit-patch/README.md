# Commit Patch

Downloads the patch [`common/create-patch`](../create-patch) uploaded in an earlier job of the same run, or in the
run `run_id` names, refuses it unless every path it changes passes the policy below, and commits it to the branch as a
verified commit through the GraphQL `createCommitOnBranch` mutation that `common/commit-changes` uses.

This is the half that holds the write token, and the job it runs in must not execute repository code: no
`bun install`, no repository scripts, no `./` action reference. The patch is applied to a throwaway index with `git`
plumbing, and the committed bytes are read from git's object store by blob SHA, never from the working tree.

## Usage

```yaml
jobs:
  format:
    # ... runs the formatter, then common/create-patch with artifact_name: format-patch

  commit:
    needs: format
    runs-on: ubuntu-latest
    environment: ci
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@<sha>
        with:
          persist-credentials: false
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
      - id: token
        uses: actions/create-github-app-token@<sha>
        with:
          app-id: ${{ secrets.APP_ID }}
          private-key: ${{ secrets.PRIVATE_KEY }}
          permission-contents: write
      - uses: TimSchoenle/actions/actions/common/commit-patch@<sha> # tag=actions-common-commit-patch-v1.1.0
        with:
          token: ${{ steps.token.outputs.token }}
          artifact_name: format-patch
          allowed_paths: 'src/** README.md'
          commit_message: 'style: auto-format code'
```

The checkout is there for git's objects: the patch is applied on top of `expected_head_sha` and needs that commit's
tree. Nothing in it is executed, and `persist-credentials: false` keeps the job token out of `.git/config`.

### Committing from a `workflow_run`

A `pull_request` run executes the pull request's own copy of the workflow, so a job there that reads the App's
private key hands it to anyone who can push a branch: they edit the workflow and print it. Splitting the work across
two workflows keeps the key out of every run a pull request can change. The `pull_request` workflow runs the formatter
and `create-patch` with no secrets. A second workflow, triggered by `workflow_run` when the first completes, always
runs the copy on the default branch, and commits the patch with `run_id`:

```yaml
name: Auto Format Commit

on:
  workflow_run:
    workflows: ['Auto Format'] # the name: of the pull_request workflow
    types: [completed]

permissions: {}

jobs:
  commit:
    # Only a successful pull_request run from a branch of this repository, never the default branch.
    if: >-
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.event == 'pull_request' &&
      github.event.workflow_run.head_repository.full_name == github.repository &&
      github.event.workflow_run.head_branch != github.event.repository.default_branch
    runs-on: ubuntu-latest
    environment: ci
    permissions:
      actions: read # to download the artifact from the pull_request run
      contents: read # to fetch code
    steps:
      - uses: actions/checkout@<sha>
        with:
          persist-credentials: false
          ref: ${{ github.event.workflow_run.head_sha }}
      - id: token
        uses: actions/create-github-app-token@<sha>
        with:
          client-id: ${{ secrets.APP_CLIENT_ID }}
          private-key: ${{ secrets.PRIVATE_KEY }}
          permission-contents: write
      - uses: TimSchoenle/actions/actions/common/commit-patch@<sha> # tag=actions-common-commit-patch-v1.2.0
        with:
          token: ${{ steps.token.outputs.token }}
          run_id: ${{ github.event.workflow_run.id }}
          artifact_name: format-patch
          allowed_paths: 'src/** README.md'
          commit_message: 'style: auto-format code'
          branch: ${{ github.event.workflow_run.head_branch }}
          expected_head_sha: ${{ github.event.workflow_run.head_sha }}
```

`branch` and `expected_head_sha` have to be set: their defaults read the `pull_request` and `push` payloads, which a
`workflow_run` event does not carry. The `pull_request` workflow has to check out `github.event.pull_request.head.sha` before
running `create-patch`, not the merge commit it checks out by default, or every patch is skipped as `branch_moved`.
`workflows:` matches by name, so a pull request that adds another workflow with that name triggers the job too, and a
`success` conclusion says nothing about what was uploaded. The artifact is still untrusted, since the pull request decided what the first
workflow uploaded; the policy below and `expected_head_sha` are what bound it, so keep `allowed_paths` as narrow as the
generated files. A pull request from a fork has a `head_repository` of its own and is skipped by the `if:`. A pull request can name any branch of this repository as
its head, including a protected one other than the default branch, and the `pull_request` run then executes the base
branch's copy of the workflow, which the author may have written. The App must therefore not be able to bypass
protection on any branch, or the `if:` has to exclude every protected branch, for example
`!startsWith(github.event.workflow_run.head_branch, 'release/')`. Keep the
App's secrets in an environment whose deployment branches allow only the default branch, so a `pull_request` job that
names the environment gets nothing either.

## Inputs

| Input                    | Required | Default                                                   | Description                                                          |
| ------------------------ | -------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `token`                  | yes      |                                                           | App installation token with `contents: write`.                      |
| `artifact_name`          | yes      |                                                           | The `artifact_name` given to `create-patch`.                         |
| `allowed_paths`          | yes      |                                                           | Whitespace-separated globs every changed path must match.            |
| `allow_workflow_changes` | no       | `false`                                                   | Accept changes under `.github/workflows/`.                           |
| `allow_binary`           | no       | `false`                                                   | Accept binary changes.                                               |
| `commit_message`         | yes      |                                                           | The commit message. The first line is the headline.                  |
| `repository`             | no       | `${{ github.repository }}`                                | `owner/repo` to commit to.                                           |
| `branch`                 | no       | `${{ github.head_ref \|\| github.ref_name }}`             | Branch to commit to.                                                 |
| `expected_head_sha`      | no       | `${{ github.event.pull_request.head.sha \|\| github.sha }}` | Commit the branch and the checkout must be at.                     |
| `max_patch_bytes`        | no       | `10485760`                                                | Largest patch accepted. Keep it equal on both actions.               |
| `run_id`                 | no       |                                                           | Run of this repository to download from. Empty means this run.       |

`allowed_paths` is a small glob dialect on purpose: `*` and `?` stay within one path segment and match a leading `.`;
`**` is a whole segment and spans any number of them. Character classes, braces, `!` and `\` fail the step rather than
being half-supported. `dist/**` admits everything under `dist/`; `.github/workflows/verify-action-*.yaml` admits those
files and no other workflow.

`allow_workflow_changes: true` also needs a token with `workflows: write`. GitHub refuses a commit that touches
`.github/workflows/` without it, whatever the action allows.

## Outputs

| Output              | Description                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `changes_committed` | `true` when a commit was created.                                                            |
| `commit_sha`        | SHA of the created commit, when one was created.                                             |
| `commit_url`        | URL of the created commit, when one was created.                                             |
| `outcome`           | `committed`, `no_changes`, or `branch_moved` when the patch or the branch is no longer at `expected_head_sha`. |

## Permissions

| Permission                  | Needed when                              |
| --------------------------- | ---------------------------------------- |
| `contents: read` (job)      | always, for the checkout                 |
| `contents: write` (token)   | always                                   |
| `workflows: write` (token)  | `allow_workflow_changes` is `true`       |
| `actions: read` (job)       | `run_id` is set                          |

Downloading an artifact from the same run needs no `actions: read`. With `run_id` the download goes through the REST
API with the job token, which needs it.

## Policy

Every path the applied patch changes is checked, and every violation is listed before the step fails. Nothing is
committed unless all of them pass. Paths, modes and binary hunks are judged before any content is read, and a change
refused by those checks is never read. Only the changes that pass them are read, and a change refused for binary content
is refused only after its content has been read, since reading it is how that content is found.

- **The path is a plain relative path:** not empty, not absolute, no `..`, `.` or empty segment, no `.git` segment in
  any case, no backslash, control character or bytes that are not valid UTF-8.
- **It is not below a symbolic link or a submodule** of the base commit, and the change does not create, modify or
  delete one.
- **It matches `allowed_paths`.** A rename is judged as a deletion of the old path and an addition of the new one, so
  moving a file out of the allowlist is refused.
- **It is not under `.github/workflows/`**, compared case-insensitively, unless `allow_workflow_changes` is `true`.
- **It is not binary**, unless `allow_binary` is `true`. Binary means a binary hunk in the patch or new content with a
  NUL byte in its first 8000 bytes, which is git's own test.
- **No file mode changes.** A new file must be `100644`, a mode change is refused, and so is a content change to an
  existing executable. The GraphQL commit API cannot record a mode, so the commit would differ from the patch. Deleting
  an executable is allowed.

The policy judges git's view of the result: the patch is applied to a throwaway index on top of the base, and what
`git diff-index` then reports is what is checked. A patch written to read one way and apply another gains nothing.

## Behaviour

- **A stale patch is skipped, not committed.** When the artifact's base is not `expected_head_sha`, or the branch has
  moved past it by the time of the commit, the step ends with a notice and `outcome: branch_moved`. The run for the new
  head redoes the work. The commit carries `expectedHeadOid`, so a push that lands in between makes GitHub refuse it.
- **A checkout at another commit fails the step.** It means the workflow checked out something other than
  `expected_head_sha`, and applying the patch there would commit against a tree it was not made from.
- **The artifact is validated before git sees it:** exactly `changes.patch` and `metadata.json`, both regular files
  opened without following links, the patch within `max_patch_bytes` and matching the size and SHA-256 recorded beside
  it. The digest catches a truncated upload; it is not a signature, since both files come from the same untrusted job.
- The composite runs its TypeScript with the `node` on the runner's `PATH`; a self-hosted runner needs Node.js 20 or
  later installed.
