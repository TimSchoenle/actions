# Java-gradle Auto-spotless

Runs Gradle's `spotlessApply` in the caller's checkout and uploads what it changed as a
[`common/create-patch`](../../common/create-patch) artifact. A later job commits it with
[`common/commit-patch`](../../common/commit-patch). This action holds no token and commits nothing.

The work is split because `./gradlew spotlessApply` runs the repository's own wrapper, build scripts and plugins, so on a
pull request it runs whatever that pull request put there. Code running in a job can read every credential that job
holds, and `persist-credentials: false` does not stop that. Up to v1 this action minted an App token with
`contents: write` and `pull-requests: write` and then ran Gradle beside it. Now the job that runs Gradle holds nothing,
and the job that holds the token runs no repository code.

## Usage

```yaml
name: Auto Spotless

on:
  pull_request:

# A newer push supersedes the run formatting the older head.
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions: {}

jobs:
  # Runs the pull request's build. Holds no secret and no write permission.
  format:
    name: Spotless
    runs-on: ubuntu-latest
    permissions:
      contents: read # to fetch code
    outputs:
      changes_detected: ${{ steps.spotless.outputs.changes_detected }}
    steps:
      - uses: actions/checkout@<sha> # v6
        with:
          persist-credentials: false
          ref: ${{ github.event.pull_request.head.sha }}

      - id: spotless
        uses: TimSchoenle/actions/actions/java-gradle/auto-spotless@<sha> # tag=actions-java-gradle-auto-spotless-v2.0.0
        with:
          java_version: '21'
          artifact_name: auto-spotless

  # Holds the write token. Runs no repository code.
  commit:
    name: Commit Spotless
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
          permission-pull-requests: write # only for the comment below

      - id: commit
        uses: TimSchoenle/actions/actions/common/commit-patch@<sha> # tag=actions-common-commit-patch-v1.1.0
        with:
          token: ${{ steps.token.outputs.token }}
          artifact_name: auto-spotless
          allowed_paths: '**/*.java **/*.kt **/*.kts **/*.gradle'
          commit_message: 'style: apply spotless formatting'

      # Optional. v1 posted this comment itself.
      - if: steps.commit.outputs.changes_committed == 'true'
        uses: TimSchoenle/actions/actions/common/upsert-pr-comment@<sha> # tag=actions-common-upsert-pr-comment-v1.3.0
        with:
          token: ${{ steps.token.outputs.token }}
          identifier: 'java-gradle-auto-spotless'
          body: 'Applied spotless formatting.'
```

- **Check out the pull request head**, `github.event.pull_request.head.sha`, in both jobs, not the default merge commit.
  `commit-patch` only commits a patch computed against its `expected_head_sha`, which defaults to that commit, and
  skips any other with `outcome: branch_moved`.
- **Check out at the workspace root.** `./gradlew` and `create-patch` both run in `$GITHUB_WORKSPACE`, so a checkout
  with a `path:` is not seen.
- **Name the artifact literally in the commit job.** `artifact_name` is an output of a job that ran pull request code.
  `commit-patch` validates whatever it is given, but a literal leaves nothing to validate.
- **`allowed_paths` decides what may be committed**, in the job Gradle cannot reach. List the file types your
  `spotless { }` block formats and nothing else. The value above covers the `java`, `kotlin`, `kotlinGradle` and
  `groovyGradle` extensions; add, say, `**/*.md` for `markdown` or `**/*.xml` for `format 'xml'`. A patch touching any
  other path, or a workflow file, binary content, a file mode or a path below a symbolic link, fails the commit job and
  nothing is committed.
- **Ignore Gradle's own output.** The patch includes untracked files that are not ignored, and running Gradle creates
  `.gradle/`, `build/` and, for Kotlin, `.kotlin/`. Keep them in `.gitignore`, or narrow `paths`, or the commit job
  refuses them.
- **Trigger on `pull_request`, not `pull_request_target`.** Under `pull_request_target` the format job would run the
  pull request's build with the base branch's cache scope.
- **Keep secrets out of the format job.** No `secrets.*`, no `id-token: write`, no write permission. Storing the App
  key as an environment secret and giving only the commit job that `environment:` keeps it out of every other job.

The `if:` on the commit job reads `changes_detected` from the job that ran pull request code. That only decides
whether the commit job runs at all: a forged `true` reaches `commit-patch`, which reads the artifact itself and ends
with `outcome: no_changes` when it is empty.

## Inputs

| Input                            | Required | Default         | Description                                                                 |
| -------------------------------- | -------- | --------------- | --------------------------------------------------------------------------- |
| `java_version`                   | yes      |                 | Java version to set up.                                                     |
| `java_distribution`              | no       | `temurin`       | Java distribution.                                                          |
| `java_package`                   | no       | `jdk`           | Package type: `jdk`, `jre`, `jdk+fx` or `jre+fx`.                            |
| `gradle_wrapper_validation`      | no       | `true`          | Validate the Gradle wrapper checksum.                                       |
| `gradle_wrapper_allow_snapshots` | no       | `false`         | Accept snapshot wrappers during validation.                                 |
| `gradle_spotless_command`        | no       | `spotlessApply` | Gradle task to run, passed to `./gradlew` as one argument.                  |
| `paths`                          | no       | `.`             | Space- or newline-separated paths or globs scoping the patch, as `create-patch` takes them. `.` is the whole tree. |
| `artifact_name`                  | no       | `auto-spotless` | Name of the patch artifact. Pass the same name to `commit-patch`. Letters, digits, `.`, `_`, `-`. |

`paths` only narrows the patch. What may be committed is decided by `allowed_paths` on `commit-patch`.

## Outputs

| Output             | Description                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `changes_detected` | `true` when the Spotless task changed a file within `paths`.       |
| `artifact_name`    | Name of the uploaded patch artifact.                               |
| `base_sha`         | The commit the patch was computed against: `HEAD` of the checkout. |

## Permissions

| Permission       | Needed when |
| ---------------- | ----------- |
| `contents: read` | always      |

The commit job's permissions are listed in [`common/commit-patch`](../../common/commit-patch#permissions).

## Behaviour

- Java and Gradle are set up by [`java-gradle/setup-base-environment`](../setup-base-environment), which validates the
  wrapper and makes `./gradlew` executable.
- Executable bits are not part of the patch, so making `./gradlew` executable is never committed.
- The artifact is kept for one day. Its name must be unique within the run; give each call its own `artifact_name` when
  a workflow runs the action more than once.

## Migrating from v1

v1 was one step that checked out, formatted, committed and commented. v2 is the first job of the workflow above.

| v1                                   | v2                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `bot_app_id`, `bot_private_key`      | Removed. Mint the token in the commit job and pass it to `commit-patch`. |
| `repository`, `branch`               | Removed. Check out before the action; give `repository` and `branch` to `commit-patch` when they are not the pull request's. |
| `commit_message`                     | Moved to `commit-patch`, where it is required.                           |
| `comment_message`                    | Removed. Post the comment from the commit job, as above.                 |
| Java, Gradle and spotless inputs     | Unchanged.                                                               |
| Output `changes_detected`            | Unchanged in name: now `true` when there is a patch, not a commit. `commit-patch` reports `changes_committed`. |
