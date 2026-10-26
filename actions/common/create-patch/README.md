# Create Patch

Records what a formatter or generator changed in the checkout as a binary `git` patch against `HEAD`, and uploads it
with the commit it was computed against. [`common/commit-patch`](../commit-patch) commits it from a later job of the
same run.

The two halves exist because a job that runs repository code cannot be trusted with a write token. `bun run format` on a
pull request runs whatever that pull request put in `package.json`, and code running in a job can read every credential
the job holds — including by rewriting an action's `dist/index.js` under `_actions/` before that action's step starts.
`persist-credentials: false` does not stop that. This action runs in the job that holds nothing; the job holding the
token never executes repository code.

## Usage

```yaml
jobs:
  format:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      base_sha: ${{ steps.patch.outputs.base_sha }}
    steps:
      - uses: actions/checkout@<sha>
        with:
          persist-credentials: false
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
      - run: bun install --frozen-lockfile && bun run format
      - id: patch
        uses: <owner>/actions/actions/common/create-patch@<ref>
        with:
          artifact_name: format-patch

  commit:
    needs: format
    # ... see common/commit-patch
```

Check out the pull request head rather than the default merge commit. The patch has to apply to the branch it is
committed to, and `commit-patch` refuses one computed against any commit other than its `expected_head_sha`, which
defaults to the pull request head.

## Inputs

| Input             | Required | Default    | Description                                                                         |
| ----------------- | -------- | ---------- | ----------------------------------------------------------------------------------- |
| `artifact_name`   | yes      |            | Artifact name, which `commit-patch` downloads by. Letters, digits, `.`, `_`, `-`.   |
| `paths`           | no       | `.`        | Space- or newline-separated paths or globs scoping the patch. `.` is the whole tree. |
| `max_patch_bytes` | no       | `10485760` | Largest patch before the step fails. Keep it equal on both actions.                 |

`paths` takes what `common/commit-changes` takes as `file_pattern`: a glob is matched across directories, so
`actions/**/dist/**` reaches every bundle. It only narrows the patch. What may be committed is decided by
`allowed_paths` on `commit-patch`, in the job this one cannot influence.

## Outputs

| Output          | Description                                                     |
| --------------- | --------------------------------------------------------------- |
| `has_changes`   | `true` when the patch is non-empty.                             |
| `artifact_name` | Name of the uploaded artifact.                                  |
| `base_sha`      | The commit the patch was computed against: `HEAD` of the checkout. |

## Permissions

| Permission       | Needed when |
| ---------------- | ----------- |
| `contents: read` | always      |

## Behaviour

- **Untracked files are included and ignored files are not.** The tree is staged into a throwaway index, so
  `.gitignore` applies and the checkout's own index is never written.
- **An empty patch is still uploaded.** `commit-patch` reads "no changes" from the artifact, so a missing artifact is
  always an error rather than a silent no-op.
- **Executable bits are dropped.** Staging runs with `core.fileMode` off, as `commit-changes` does, because the GraphQL
  commit API cannot record a mode. A new file is recorded as `100644` whatever its permissions on disk.
- **Renames are a deletion plus an addition**, so each path is judged on its own on the other side.
- **The artifact is untrusted by design.** The job this runs in executed pull request code, so anything here may have
  been tampered with. `commit-patch` validates every byte; a tampered patch can be refused there, never committed past
  its policy.
- The artifact is kept for one day. Re-running the job overwrites it under the same name.
- The composite runs its TypeScript with the `node` on the runner's `PATH`; a self-hosted runner needs Node.js 20 or
  later installed.
