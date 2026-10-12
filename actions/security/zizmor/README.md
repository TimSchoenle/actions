# Security Zizmor

Runs [zizmor](https://docs.zizmor.sh) over a repository's workflows and actions, uploads the SARIF to code scanning
under the category `zizmor`, and fails the job when zizmor cannot read an input or finds something at or above a
severity.

`zizmorcore/zizmor-action` passes in both of those cases. zizmor logs `failed to parse input` for a file it cannot load,
drops it and exits 0, and in SARIF mode it exits 0 whatever it finds. On 2026-10-12 that let five repositories pass the
zizmor check while a UTF-8 byte order mark kept their whole `.github/workflows` directory out of the audit.

## Usage

```yaml
name: Security

on:
  push:
    branches: [main]
  pull_request:

permissions: {}

jobs:
  zizmor:
    name: Zizmor
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@<ref>
        with:
          persist-credentials: false

      - uses: <owner>/actions/actions/security/zizmor@<ref>
```

Keep the job name. A ruleset that requires the `Zizmor` check matches it by name.

## Inputs

| Input               | Default          | Description                                                                                                    |
| ------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `inputs`            | `.`              | Paths to audit, one per line, relative to the repository root. See [Paths](#paths).                           |
| `persona`           | `pedantic`       | `regular`, `pedantic` or `auditor`.                                                                            |
| `online-audits`     | `true`           | `false` adds `--no-online-audits` and starts the container without a network.                                  |
| `min-severity`      |                  | Passed as `--min-severity`: `informational`, `low`, `medium` or `high`.                                        |
| `min-confidence`    |                  | Passed as `--min-confidence`: `low`, `medium` or `high`.                                                       |
| `config`            |                  | zizmor configuration file. Empty lets zizmor discover `zizmor.yml` itself.                                     |
| `fail-on-severity`  | `informational`  | Lowest severity that fails the job: `informational`, `low`, `medium`, `high`, or `none`.                       |
| `strict-collection` | `true`           | `false` lets zizmor skip a file it cannot parse. Only for a file zizmor wrongly rejects; link the upstream issue next to it. |
| `upload`            | `true`           | Upload the SARIF to code scanning. Needs `security-events: write`.                                            |
| `token`             | `github.token`   | Handed to the container as `GH_TOKEN` for online audits. Must not be empty while `online-audits` is on.        |

## Outputs

| Output       | Description                                                                               |
| ------------ | ----------------------------------------------------------------------------------------- |
| `sarif-file` | Absolute path of the SARIF under `RUNNER_TEMP`. Empty when zizmor did not complete.        |
| `sarif-id`   | ID of the uploaded analysis, when `upload` is true.                                       |
| `findings`   | Number of results in the SARIF. A finding ignored by a comment or the configuration is not one. |
| `failing`    | Number of results at or above `fail-on-severity`.                                         |

## Permissions

| Permission               | Needed when                                                    |
| ------------------------ | -------------------------------------------------------------- |
| `contents: read`         | always                                                         |
| `security-events: write` | `upload` is true                                               |
| `actions: read`          | `upload` is true and the repository is private                 |

## Egress

A job that runs `step-security/harden-runner` with `egress-policy: block` has to allow:

| Endpoint                                 | For                               |
| ---------------------------------------- | --------------------------------- |
| `ghcr.io:443`                            | the image pull                    |
| `pkg-containers.githubusercontent.com:443` | the image layers                |
| `api.github.com:443`                     | online audits and the SARIF upload |

## Paths

Each line of `inputs` must name a file or a directory inside the workspace. A path that does not exist is refused,
because zizmor reads a missing `owner/repo` as a repository to fetch from GitHub. A path outside the workspace, through
`..`, an absolute path or a committed symbolic link, is refused too: the container only sees the workspace.

zizmor collects these from a directory:

- `action.yml` and `action.yaml` anywhere
- `*.yml` and `*.yaml` directly inside any `.github/workflows` directory
- `dependabot.yml` inside `.github`, and `.pre-commit-config.yaml` and `.pre-commit-hooks.yaml` anywhere

Nothing else. A reusable workflow kept as `workflows/release/workflow.yaml` is audited only when the file is named on a
line of its own. A line starting with `-` is refused, since zizmor would read it as a flag or as standard input; write
`./-name` for a file that really starts with a dash.

## Behaviour

- **Every input is validated before the image is pulled.** A typo in `persona` or `fail-on-severity` fails in a second.
- **A byte order mark fails the job and is annotated on its file.** zizmor stops at the first file it cannot load and
  its warning does not name it, so the action reads the first three bytes of every file zizmor would collect and
  annotates each one that starts with `EF BB BF`. With `strict-collection: false` the annotations are warnings and
  zizmor skips those files.
- **zizmor runs in a locked-down container.** `ghcr.io/zizmorcore/zizmor` is pinned by tag and digest in `action.yaml`,
  and Renovate bumps both. The workspace is mounted read-only, the root filesystem is read-only with a tmpfs for the
  cache, all capabilities are dropped, the user is `nobody`, and an offline run has no network. The token is passed to
  the container by name, so it never appears in an argument list.
- **zizmor's log is relayed with every line prefixed by `|`.** It repeats file names from the repository, and a line
  that started with `::` would otherwise be a workflow command.
- **The upload runs only when zizmor read every input.** A failed run writes no SARIF, so nothing replaces the last good
  analysis in code scanning.
- **The gate runs after the upload**, so findings reach code scanning whether or not they fail the job. A finding whose
  `zizmor/severity` is missing or unknown counts as failing at every threshold but `none`.
- Linux runners only: the action needs Docker running Linux containers. The composite runs its TypeScript with the
  `node` on the runner's `PATH`.
