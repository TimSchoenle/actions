# Docker Image Check

Measures a locally loaded image, warns past a size threshold, scans it with Trivy, uploads the SARIF to code scanning
and reports the result on the pull request — the four steps every service repository used to carry inline after its
`docker/build-push-action` step.

The image must already be in the Docker daemon. Building stays in the caller, because every repository passes its own
build arguments, cache scopes and outputs to `docker/build-push-action`.

## Usage

One call per image, in the job that loaded it:

```yaml
permissions:
  contents: read
  security-events: write # upload-sarif
  pull-requests: write # the comment

steps:
  - uses: docker/build-push-action@<sha> # vX
    with:
      tags: app:test
      load: true

  - uses: <owner>/actions/actions/docker/image-check@<ref>
    with:
      image: app:test
```

In a matrix, pass each leg's `platform`. The slug (`linux/arm64` becomes `linux-arm64`) keeps the SARIF category, the
comment identifier and the summary artifact of each leg apart:

```yaml
strategy:
  matrix:
    platform: [linux/amd64, linux/arm64]
steps:
  - uses: <owner>/actions/actions/docker/image-check@<ref>
    with:
      image: app:test
      platform: ${{ matrix.platform }}
```

Two images in one job take two calls with different `platform` values.

### One table for every leg

A matrix leg can only write its own comment; it cannot edit one another leg owns without racing it. For a single table,
set `comment: summary` on every leg and run [`docker/image-check-summary`](../image-check-summary) once, after all of
them:

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
    if: always() && github.event_name == 'pull_request'
    permissions:
      pull-requests: write
    runs-on: ubuntu-latest
    steps:
      - uses: <owner>/actions/actions/docker/image-check-summary@<ref>
```

## Inputs

| Input                    | Required | Default                    | Description                                                                                                              |
| ------------------------ | -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `image`                  | yes      |                            | Local image reference, already loaded (`load: true`).                                                                    |
| `platform`               | no       | `''`                       | Platform label, e.g. `linux/arm64`. Required with `comment: summary`.                                                    |
| `size-warning-mib`       | no       | `150`                      | Warn above this many MiB. `0` disables it.                                                                               |
| `size-limit-mib`         | no       | `0`                        | Fail above this many MiB. `0` disables it.                                                                               |
| `trivy-severity`         | no       | `CRITICAL,HIGH`            | Severities Trivy reports. Governs the SARIF too.                                                                         |
| `trivy-ignore-unfixed`   | no       | `false`                    | Ignore vulnerabilities without a fixed version.                                                                          |
| `trivy-fail-on-findings` | no       | `false`                    | Fail when Trivy reports at least one finding.                                                                            |
| `trivy-ignore-file`      | no       | `''`                       | Workspace-relative `.trivyignore`.                                                                                       |
| `upload-sarif`           | no       | `true`                     | Upload the SARIF to code scanning.                                                                                       |
| `sarif-category`         | no       | `trivy-<slug>`, or unset   | Code scanning category. Without a platform it stays unset, so upload-sarif's default applies.                            |
| `comment`                | no       | `per-image`                | `per-image` upserts this image's comment, `summary` uploads a fragment for `image-check-summary`, `none` does neither.   |
| `comment-identifier`     | no       | `docker-image-size[-slug]` | `upsert-pr-comment` identifier.                                                                                          |
| `token`                  | no       | `${{ github.token }}`      | Token for the comment, and nothing else.                                                                                 |

Every input is validated before anything slow runs: a threshold that is not a number, a severity Trivy does not know or
an image reference beginning with `-` fails the step in a second, not after the scan.

## Outputs

| Output         | Description                                                                         |
| -------------- | ----------------------------------------------------------------------------------- |
| `size-bytes`   | `.Size` from `docker image inspect`: bytes of unpacked layers.                      |
| `size-mib`     | `size-bytes` / 1048576, to one decimal place.                                       |
| `over-warning` | `true` when above `size-warning-mib`.                                               |
| `findings`     | Number of results in the SARIF file.                                                |
| `sarif-path`   | Absolute path of the SARIF file, under `RUNNER_TEMP`.                               |
| `comment-url`  | URL of the comment, when `comment` is `per-image` and one was written.              |

## Permissions

The action asks for no permission itself. Set the job's `permissions` block from this table:

| Permission               | Needed when                                         |
| ------------------------ | --------------------------------------------------- |
| `contents: read`         | always                                              |
| `security-events: write` | `upload-sarif: true`                                |
| `pull-requests: write`   | `comment: per-image`, and in the summary job        |

`comment: summary` needs no extra permission in the leg: uploading an artifact does not use the token.

## Behaviour

The action publishes its evidence first and enforces its gates last, so a red build always carries its reason on the
pull request and in code scanning:

1. **Measure.** Validates every input, then reads `.Size` with `docker image inspect`. An image that is not loaded
   fails here, naming the reference, before Trivy can fail on it with a less useful message.
2. **Scan.** Trivy writes SARIF under `RUNNER_TEMP`, never the workspace, so a later `git add` or `commit-changes`
   cannot pick it up; its database cache sits there too. Trivy itself never fails the step.
3. **Upload.** `upload-sarif`, when enabled.
4. **Report.** Writes a table row to the step summary on every event. On a pull request it then upserts the comment
   (`per-image`) or uploads the fragment `image-check-<slug>` (`summary`).
5. **Enforce.** Warns above `size-warning-mib`. Fails above `size-limit-mib`, or on findings when
   `trivy-fail-on-findings` is `true`.

`trivy-severity` is passed with `limit-severities-for-sarif: true`. Without that flag trivy-action drops the severity
filter for SARIF output, and every LOW and MEDIUM finding reaches code scanning whatever the input says.

**Sizes are uncompressed.** Both thresholds compare `.Size` in MiB — the unpacked layers, not the pull size. A
compressed size would need the image pushed to a registry, and nothing here pushes on a pull request. A size exactly at
a threshold passes it.

**Pull requests from a fork.** `GITHUB_TOKEN` is read-only there, so the SARIF upload and the comment would both fail.
When the pull request's head repository is not this repository, steps 3 and 4 skip with a notice, and the step summary
carries the result. A fork that has since been deleted counts as a fork.

### Requirements

The composite runs its TypeScript with the `node` on the runner's `PATH`, which every GitHub-hosted runner has. A
self-hosted runner needs Node.js 20 or later installed.

A job that blocks egress (for example with `step-security/harden-runner`) has to allow what Trivy reaches:
`github.com`, `get.trivy.dev` and `release-assets.githubusercontent.com` for the binary, `mirror.gcr.io` and `ghcr.io`
for the vulnerability database, `api.github.com` for the SARIF upload and the comment, and the Actions cache and
artifact hosts (`*.actions.githubusercontent.com`, `*.blob.core.windows.net`).

## Comment

`per-image`, identifier `docker-image-size-linux-amd64`:

```markdown
**Docker image** `linux/amd64`: 87.4 MiB (uncompressed), warning above 150 MiB.
Trivy: 3 findings at CRITICAL,HIGH. [Code scanning](https://github.com/<owner>/<repo>/security/code-scanning?query=pr%3A<number>)
```

Without a platform, the image reference names the image instead. The link is omitted when the SARIF was not uploaded.

## Migrating an inline copy

- **Keep existing comments.** The derived identifier for `linux/amd64` is `docker-image-size-linux-amd64`. A repository
  that posted `docker-image-size-amd64` should pass `comment-identifier: docker-image-size-${{ matrix.arch }}`, or open
  pull requests get a second comment beside the old one.
- **Keep existing alerts.** A repository that uploaded under its own category passes it as `sarif-category`.
- **Expect closed alerts.** The first upload with the severity filter actually applied closes every existing LOW and
  MEDIUM alert in code scanning. That drop is the fix, not a regression.
