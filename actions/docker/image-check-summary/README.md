# Docker Image Check Summary

Collects the fragments [`docker/image-check`](../image-check) legs upload with `comment: summary` and posts one table of
every image on the pull request.

A matrix leg can only write its own comment: editing one another leg owns would race it. This action runs once, in its
own job, after all of them.

## Usage

```yaml
jobs:
  build:
    strategy:
      matrix:
        platform: [linux/amd64, linux/arm64]
    steps:
      # ... build and load ...
      - uses: <owner>/actions/actions/docker/image-check@<ref>
        with:
          image: app:test
          platform: ${{ matrix.platform }}
          comment: summary

  image-size-report:
    needs: build
    # always(), so one failed leg does not cost the table the rows of the others.
    if: always() && github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: <owner>/actions/actions/docker/image-check-summary@<ref>
```

Pin both actions to the same release. The fragment carries a schema version, and a fragment written by a different
release fails the step rather than rendering a wrong row.

## Inputs

| Input              | Required | Default               | Description                                                   |
| ------------------ | -------- | --------------------- | ------------------------------------------------------------- |
| `identifier`       | no       | `docker-image-size`   | `upsert-pr-comment` identifier of the summary comment.        |
| `token`            | no       | `${{ github.token }}` | Token with `pull-requests: write`, for the comment.           |
| `artifact-pattern` | no       | `image-check-*`       | Glob matching the fragment artifacts, named `image-check-<slug>`. |

## Outputs

| Output        | Description                                     |
| ------------- | ----------------------------------------------- |
| `comment-url` | URL of the summary comment, when one was written. |
| `images`      | Number of fragments read.                       |

## Permissions

| Permission             | Needed when |
| ---------------------- | ----------- |
| `contents: read`       | always      |
| `pull-requests: write` | always      |

Downloading artifacts from the same run needs no `actions: read`.

## Comment

```markdown
**Docker images**

| Platform | Size (MiB, uncompressed) | Trivy findings |
| --- | --- | --- |
| `linux/amd64` | 87.4 | 3 |
| `linux/arm64` | 162.0 (above 150) | 3 |

Trivy findings at CRITICAL,HIGH.
```

Rows are sorted by platform, so the table does not reorder with job finish times. When the legs scanned at different
severities, each count names its own instead of the line under the table.

## Behaviour

- **A missing leg is a missing row.** A leg that failed before uploading its fragment is absent from the table. With no
  fragments at all the action warns and posts nothing, rather than overwriting an earlier table with an empty one.
- **Duplicates.** Two fragments for one platform keep the one read last, and the step warns naming the platform.
- **Invalid fragments fail the step**, naming the artifact. Every field is validated before it reaches Markdown.
- **Outside a pull request,** and on a pull request from a fork, the table goes to the step summary and no comment is
  written.
- The composite runs its TypeScript with the `node` on the runner's `PATH`; a self-hosted runner needs Node.js 20 or
  later installed.
