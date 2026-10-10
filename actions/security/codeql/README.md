# Security CodeQL

Runs CodeQL on one language with `build-mode: none`, excludes test sources, and uploads the result to code scanning.

Default setup reads a configuration file only from the `github-codeql-config-file` repository property, and custom
properties exist for organizations alone. A repository owned by a personal account cannot exclude a path from default
setup, so a fixture key raises `rust/hard-coded-cryptographic-value` and an assertion message that formats a value named
`secret` raises `rust/cleartext-logging`, exactly as production code would. This action is the advanced setup that
replaces it.

## Usage

```yaml
name: CodeQL

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: '0 0 * * 1'

permissions: {}

jobs:
  analyze:
    name: Analyze (${{ matrix.language }})
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    strategy:
      fail-fast: false
      matrix:
        language: [rust, actions]
    steps:
      - uses: actions/checkout@<ref>
        with:
          persist-credentials: false

      - uses: <owner>/actions/actions/security/codeql@<ref>
        with:
          language: ${{ matrix.language }}
          paths-ignore: |
            # Seeds the integration database with fixed credentials.
            services/api/test-support/**
```

Turn default setup off before the first run. GitHub rejects an advanced-setup upload while it is enabled.

## Inputs

| Input                | Required | Default | Description                                                                                     |
| -------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------- |
| `language`           | yes      |         | One CodeQL language per job. See [Languages](#languages).                                       |
| `exclude-test-paths` | no       | `true`  | Exclude the [shared test paths](#excluded-paths).                                               |
| `paths-ignore`       | no       |         | More patterns to exclude, one per line, relative to the repository root. `#` lines are skipped. |
| `category`           | no       |         | Code scanning category. Empty is `/language:<language>`, the category default setup writes.     |
| `upload`             | no       | `true`  | Upload the SARIF to code scanning. Needs `security-events: write`.                              |

## Outputs

| Output         | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `config`       | The CodeQL configuration passed to `init`, as one line of JSON. |
| `category`     | The category the analysis was recorded under.             |
| `sarif-output` | Absolute path of the directory holding the SARIF file.    |
| `sarif-id`     | ID of the uploaded SARIF, when `upload` is true.          |

## Permissions

| Permission              | Needed when                                         |
| ----------------------- | --------------------------------------------------- |
| `contents: read`        | always                                              |
| `security-events: write` | `upload` is true                                   |
| `actions: read`         | the repository is private, for the workflow run metadata CodeQL records |

## Languages

`actions`, `c-cpp`, `csharp`, `java-kotlin`, `javascript-typescript`, `python`, `ruby` and `rust`: the languages CodeQL
analyses without a build. `paths-ignore` is honoured only for a language that is not built, which is why the action
builds nothing.

- **Aliases are refused.** `typescript`, `java` and the other short spellings fail with the canonical identifier to use.
  Default setup categorises by the canonical one, and an alias would record a second analysis beside it.
- **Go and Swift are refused.** Both need a build. Use `github/codeql-action` directly with the build steps.

## Excluded paths

With `exclude-test-paths` on, these are excluded before any `paths-ignore` pattern:

| Pattern                                    | Covers                                                  |
| ------------------------------------------ | ------------------------------------------------------- |
| `**/tests/**`, `**/benches/**`             | Cargo integration tests and benchmarks                  |
| `**/tests.rs`, `**/*_tests.rs`, `**/*_test.rs` | Rust unit-test modules kept in a file of their own  |
| `**/src/test/**`, `**/src/testFixtures/**` | Gradle and Maven test source sets, and `java-test-fixtures` |
| `**/__tests__/**`, `**/*.test.*`, `**/*.spec.*` | Vitest and Jest suites                             |

Patterns match whole files. A `#[cfg(test)] mod tests { ... }` block inside a production source file is still analysed.

## Behaviour

- **Patterns are validated before CodeQL starts.** CodeQL matches `?`, `+`, `[`, `]` and `!` literally and recognises
  `**` only as a whole path segment, so a pattern relying on either would exclude nothing. Those fail the step, as do an
  absolute path, a `.` or `..` segment and a backslash.
- **The configuration is passed inline** through `init`'s `config` input. A `config-file` in this repository would need
  a ref of its own beside the one pinning the action.
- **Checkout is the caller's.** The action analyses the workspace as it finds it.
- The composite runs its TypeScript with the `node` on the runner's `PATH`; a self-hosted runner needs Node.js 20 or
  later installed.
