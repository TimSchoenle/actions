# Security Jactionlint

Runs [jactionlint](https://github.com/jdx/jactionlint) over a repository's workflows, composite actions and Dependabot
config, annotates the findings on the pull request, writes a per-rule and per-file summary, uploads the SARIF to code
scanning under the category `jactionlint`, and fails the job when a finding counts.

jactionlint is a fork of actionlint that keeps every actionlint check and has a rule for every zizmor audit, so one job
replaces both.

`jdx/jactionlint`'s own action downloads the release archive and runs it without checking it. Pinning that action by
commit does not pin the binary: a release asset can be replaced after it is published. This action pins the release by
version and by the SHA-256 of its checksums file, verifies the checksums file against the pin and the archive against
the checksums file, and refuses to run anything that does not match.

## Usage

```yaml
name: Security

on:
  push:
    branches: [main]
  pull_request:

permissions: {}

jobs:
  jactionlint:
    name: Action Lint
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@<ref>
        with:
          persist-credentials: false

      - uses: <owner>/actions/actions/security/jactionlint@<ref>
```

Settings such as the profile, rule levels and accepted findings belong in `.github/jactionlint.yaml`, which jactionlint
reads by itself. See [the configuration reference](https://jactionlint.jdx.dev/config).

## Inputs

| Input               | Default        | Description                                                                                                                  |
| ------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `files`             |                | Files to check, one per line, relative to `working-directory`. Empty checks the repository. See [Files](#files).            |
| `config-file`       |                | Configuration file, relative to `working-directory`. Empty lets jactionlint read `.github/jactionlint.yaml` when it exists. |
| `profile`           | `pedantic`     | `correctness`, `default` or `pedantic`. Overrides `profile` in the configuration file; empty hands it to the file. See [Profile](#profile). |
| `online`            | `false`        | Run the checks that query the GitHub API: `false`, `true`, `cache` or `strict`. See [Online checks](#online-checks).        |
| `token`             | `github.token` | Token for the online checks and the REST API download fallback. Handed to jactionlint only when `online` is not `false`.     |
| `strict-exit`       | `false`        | Also fail on findings of level `warn` and `info`, not only on `error`.                                                       |
| `fail-on-findings`  | `true`         | `false` reports the findings as annotations, in the summary and in code scanning without failing the job.                    |
| `upload`            | `true`         | Upload the SARIF to code scanning. Needs `security-events: write`. Skipped on a pull request from a fork.                    |
| `working-directory` | `.`            | Directory to run jactionlint in, relative to the workspace.                                                                  |

## Outputs

| Output       | Description                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| `version`    | The jactionlint release installed, as `vMAJOR.MINOR.PATCH`.                                                  |
| `executable` | Absolute path of the installed binary.                                                                       |
| `exit-code`  | `0` for no finding that counts, `1` for at least one. Empty when the check did not complete.                 |
| `findings`   | Number of results in the SARIF, at every level. A finding ignored by a comment, the configuration or a baseline is not one. |
| `sarif-file` | Absolute path of the SARIF under `RUNNER_TEMP`. Empty when the check did not complete.                       |
| `sarif-id`   | ID of the uploaded analysis, when the SARIF was uploaded.                                                    |

## Permissions

| Permission               | Needed when                                                         |
| ------------------------ | ------------------------------------------------------------------- |
| `contents: read`         | always                                                              |
| `security-events: write` | `upload` is true                                                    |
| `actions: read`          | `upload` is true and the repository is private, or `online` is on in a private repository |

## Egress

A job that runs `step-security/harden-runner` with `egress-policy: block` has to allow:

| Endpoint                                   | For                         |
| ------------------------------------------ | --------------------------- |
| `github.com:443`                           | the release download        |
| `objects.githubusercontent.com:443`        | the release download        |
| `release-assets.githubusercontent.com:443` | the release download        |
| `api.github.com:443`                       | the download fallback, the SARIF upload and the online checks |
| `auth.docker.io:443`, `registry-1.docker.io:443`, `ghcr.io:443` | the online checks of container images |

## Profile

The default is `pedantic`, jactionlint's counterpart of zizmor's pedantic persona: every security audit at its strictest,
plus the noisier policy and style rules. Turn off the ones a repository does not want in `.github/jactionlint.yaml`
rather than lowering the profile, so the decision and its reason are written down:

```yaml
rules:
  require-shell: off # every step runs the runner's default bash
```

`--profile` on the command line wins over the `profile` key of the configuration file, so the input decides. Set
`profile: ''` to let the configuration file choose; without a `profile` key there, jactionlint uses `default`.

## Online checks

`online` is `false` by default. The online rules (`impostor-commit`, `known-vulnerable-actions`, `actions-lock-drift`,
`ref-version-mismatch`, `ref-confusion`, `archived-uses`, `repojacking`, `stale-action-refs`, `action-release-cooldown`,
`unpinnable-action`) query the GitHub API, Docker Hub and ghcr.io about the actions and images the workflows use. They
find real problems, but as a default for a check that gates pull requests they cost more than they give:

- **The result depends on the world, not on the change.** A new advisory, a moved tag or a fresh release turns a pull
  request red that touched no workflow, and a re-run of an old commit can fail where it passed.
- **A failed lookup passes silently.** A rate limit, a 5xx or a timeout skips the lookup and leaves the exit status
  alone, so a green run does not prove the checks ran. `online: strict` makes a skipped lookup fail the job, which
  turns GitHub's availability into a flaky check.
- **The rate limit is shared.** The job token allows 1,000 requests an hour per repository, shared by every workflow run
  in it; parallel pull requests and other jobs that call the API draw on the same quota.
- **The job needs more egress**: `api.github.com`, `auth.docker.io`, `registry-1.docker.io` and `ghcr.io`, on top of
  the release download.

The token is not the concern: jactionlint sends it to the API host only, over https, refuses redirects to another host,
and ignores an `api-url` that a repository's own configuration file names, so a pull request cannot redirect it.

Run the online checks where a red result is news rather than noise: on a schedule and on pushes to the default branch.

```yaml
on:
  schedule:
    - cron: '17 6 * * 1'
  push:
    branches: [main]

jobs:
  jactionlint-online:
    name: Action Lint (online)
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@<ref>
        with:
          persist-credentials: false
      - uses: <owner>/actions/actions/security/jactionlint@<ref>
        with:
          online: 'strict'
```

## Files

Each line of `files` must name a file. jactionlint does not take a directory: leave `files` empty to check the whole
repository, which covers the workflows under `.github/workflows`, every `action.yml` and `action.yaml` outside
`node_modules`, `testdata` and similar directories, and `.github/dependabot.yml`. A line starting with `-` is refused,
because jactionlint would read it as an option; write `./-name` for a file that really starts with a dash.

## Behaviour

- **The release is verified before it runs.** `action.yaml` pins `JACTIONLINT_VERSION` and `JACTIONLINT_SHA256`, the
  SHA-256 of `jactionlint_<version>_checksums.txt`. The checksums file is checked against that pin, and the archive for
  the runner's platform against the line of the checksums file that names it. One pin covers every platform.
  Renovate's `github-release-attachments` manager in this repository bumps the version and the checksum together.
- **A failed release download falls back to the REST API.** When `github.com/<repo>/releases/download/...` fails after
  its retries (it can answer 5xx for one repository while the rest of GitHub works), the same asset is fetched through
  `api.github.com`'s release asset endpoint, authenticated with `token` when the job runs on github.com (a GHES or
  GHE.com token is never sent there). Both routes go through the same verification.
- **Every input is validated before jactionlint runs.** A typo in `profile` or `online` fails in a second, without a
  partial result.
- **The upload runs only when jactionlint completed.** Exit status 2 or higher means the check did not run to the end,
  for example on an invalid configuration file. Then no SARIF is uploaded, so nothing replaces the last good analysis
  in code scanning, and the job fails.
- **The job fails after the upload**, so findings reach code scanning whether or not they fail the job.
- **The token stays out of offline runs.** It is exported to jactionlint as `GITHUB_TOKEN` only when `online` is on.
  The install step sends it to `api.github.com` only, and only when the release download failed.
- Linux and macOS runners, on X64 or ARM64. `jq` must be on `PATH` for the `findings` output and the download
  fallback; it is on every GitHub-hosted runner.
