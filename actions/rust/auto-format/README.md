# Rust Auto-format

Runs `cargo fmt` in the caller's checkout and uploads what it changed as a [`common/create-patch`](../../common/create-patch)
artifact. A later job commits it with [`common/commit-patch`](../../common/commit-patch). This action holds no token and
commits nothing.

The work is split because `cargo fmt` is not inert on a pull request: it honours the pull request's `rust-toolchain.toml`
and `rustfmt.toml`, and the toolchain setup runs in the same job. Code running in a job can read every credential that
job holds, and `persist-credentials: false` does not stop that. Up to v1 this action minted an App token with
`contents: write` and then ran the formatter beside it. Now the job that runs the formatter holds nothing, and the job
that holds the token runs no repository code.

## Usage

```yaml
name: Auto Format

on:
  pull_request:

# A newer push supersedes the run formatting the older head.
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions: {}

jobs:
  # Runs the pull request's code. Holds no secret and no write permission.
  format:
    name: Format
    runs-on: ubuntu-latest
    permissions:
      contents: read # to fetch code
    outputs:
      changes_detected: ${{ steps.format.outputs.changes_detected }}
    steps:
      - uses: actions/checkout@<sha> # v6
        with:
          persist-credentials: false
          ref: ${{ github.event.pull_request.head.sha }}

      - id: format
        uses: TimSchoenle/actions/actions/rust/auto-format@<sha> # tag=actions-rust-auto-format-v2.0.0
        with:
          artifact_name: rust-auto-format

  # Holds the write token. Runs no repository code.
  commit:
    name: Commit Format
    needs: format
    # A fork's pull request gets no secrets, and its branch is not in this repository.
    if: needs.format.outputs.changes_detected == 'true' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions:
      contents: read # to fetch the commit the patch applies to
    steps:
      # Only git's objects are needed. Nothing in this checkout is executed.
      - uses: actions/checkout@<sha> # v6
        with:
          persist-credentials: false
          ref: ${{ github.event.pull_request.head.sha }}

      - id: token
        uses: actions/create-github-app-token@<sha> # v3
        with:
          app-id: ${{ secrets.BOT_APP_ID }}
          private-key: ${{ secrets.BOT_PRIVATE_KEY }}
          permission-contents: write

      - uses: TimSchoenle/actions/actions/common/commit-patch@<sha> # tag=actions-common-commit-patch-v1.1.0
        with:
          token: ${{ steps.token.outputs.token }}
          artifact_name: rust-auto-format
          allowed_paths: '**/*.rs'
          commit_message: 'style: auto-format rust code'
```

- **Check out the pull request head**, `github.event.pull_request.head.sha`, in both jobs, not the default merge commit.
  `commit-patch` only commits a patch computed against its `expected_head_sha`, which defaults to that commit, and
  skips any other with `outcome: branch_moved`.
- **Check out at the workspace root.** The action runs `create-patch` on `$GITHUB_WORKSPACE`, so a checkout with a
  `path:` is not seen. Use `source_directory` for a project in a subdirectory.
- **Name the artifact literally in the commit job.** `artifact_name` is an output of a job that ran pull request code.
  `commit-patch` validates whatever it is given, but a literal leaves nothing to validate.
- **`allowed_paths` decides what may be committed**, in the job the formatter cannot reach. `cargo fmt` only rewrites
  `.rs` files, so `**/*.rs` is enough; scope it to the project with, say, `crates/**/*.rs`. A patch touching anything
  else, or a workflow file, binary content, a file mode or a path below a symbolic link, fails the commit job and
  nothing is committed.
- **Trigger on `pull_request`, not `pull_request_target`.** Under `pull_request_target` the format job would run the
  pull request's code with the base branch's cache scope, which the toolchain cache writes to.
- **Keep secrets out of the format job.** No `secrets.*`, no `id-token: write`, no write permission. Storing the App
  key as an environment secret and giving only the commit job that `environment:` keeps it out of every other job.

The `if:` on the commit job reads `changes_detected` from the job that ran pull request code. That only decides
whether the commit job runs at all: a forged `true` reaches `commit-patch`, which reads the artifact itself and ends
with `outcome: no_changes` when it is empty.

## Inputs

| Input              | Required | Default            | Description                                                                                  |
| ------------------ | -------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `source_directory` | no       | `.`                | Directory of the Rust project, relative to the repository root. `cargo fmt` runs there and the patch is scoped to it. Must not contain whitespace. |
| `artifact_name`    | no       | `rust-auto-format` | Name of the patch artifact. Pass the same name to `commit-patch`. Letters, digits, `.`, `_`, `-`. |

## Outputs

| Output             | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| `changes_detected` | `true` when `cargo fmt` changed a file under `source_directory`. |
| `artifact_name`    | Name of the uploaded patch artifact.                            |
| `base_sha`         | The commit the patch was computed against: `HEAD` of the checkout. |

The commit's SHA and URL are outputs of `commit-patch`: `commit_sha`, `commit_url`, `changes_committed` and `outcome`.

## Permissions

| Permission       | Needed when |
| ---------------- | ----------- |
| `contents: read` | always      |

The commit job's permissions are listed in [`common/commit-patch`](../../common/commit-patch#permissions).

## Behaviour

- The stable toolchain is installed with `rustfmt` by `actions-rust-lang/setup-rust-toolchain`. A
  `rust-toolchain.toml` in the repository takes precedence, as it does for `cargo` anywhere.
- `cargo fmt` runs with no arguments from `source_directory`, so it formats what `cargo fmt` itself picks there.
- Only changes under `source_directory` are part of the patch: a local path dependency outside it that `cargo fmt`
  reformatted is left out.
- Untracked files under `source_directory` are part of the patch and ignored ones are not. `cargo fmt` creates none,
  but anything an earlier step of the job left there that is not in `.gitignore` reaches `commit-patch`, which fails
  the commit job when `allowed_paths` does not admit it.
- The artifact is kept for one day. Its name must be unique within the run; give each call its own `artifact_name` when
  a workflow formats more than one project.

## Migrating from v1

v1 was one step that checked out, formatted and committed. v2 is the first job of the workflow above.

| v1                                   | v2                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `bot_app_id`, `bot_private_key`      | Removed. Mint the token in the commit job and pass it to `commit-patch`. |
| `repository`, `branch`               | Removed. Check out before the action; give `repository` and `branch` to `commit-patch` when they are not the pull request's. |
| `commit_message`                     | Moved to `commit-patch`, where it is required.                         |
| `source_directory`                   | Unchanged.                                                             |
| Output `changes_detected`            | Unchanged in name: now `true` when there is a patch, not a commit. `commit-patch` reports `changes_committed`. |
| Outputs `commit_hash`, `commit_url`  | `commit_sha` and `commit_url` on `commit-patch`.                       |
