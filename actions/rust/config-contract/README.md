# Rust Config Contract

Holds a [terrace-config](https://github.com/TimSchoenle) contract, the `LABEL` block that makes it discoverable and the
built image that carries it to the configuration types they all claim to describe.

Six repositories carried a hand-written variant of this check under five different names, and they disagreed on the thing
that matters most: how to cut the generated `LABEL` block back out of a Dockerfile. `grep -A2 '^LABEL dev\.terrace'` in
one, `# contract-labels:` markers in another, `# terrace-config:labels:` markers in a third, and no markers at all in
two. The line-count variant compares two of three lines and passes the moment a fourth label is added.

## What it does

1. **Renders once.** `contract`, `labels` and `dockerfile` come from one run of one generator over one source tree. The
   three renderings are one set — the document, the labels that make it discoverable, and the block a Dockerfile carries
   — and generating them separately is the one arrangement in which they can disagree with each other rather than with
   what is committed. A rendering that came out empty is refused.
2. **Diffs the Dockerfile's marked region** against the generated block, cut at the markers rather than by line count.
3. **Diffs the committed contract** against what the types produce. `--format contract` is rendered without
   `--version`/`--revision`/`--created`, so it is byte-reproducible and this can be a diff rather than a semantic
   comparison.
4. **Checks the built image's labels.** Extra labels are ignored — every image carries `org.opencontainers.image.*` and
   whatever its base contributed.
5. **Checks something is actually at the path** the `dev.terrace.config.contract.path` label advertises.

Every enabled check runs and every fault is reported before the step fails. A run that names one missing label and hides
two, or that fails on the Dockerfile and never looks at the image, is a second round trip through a pipeline that already
took minutes.

## Requirements

The action runs in the workspace it is given: it does **not** check out the repository and does **not** install a
toolchain. Both belong to the job, and both are wrong to redo here — this step runs *after* the image is built, where a
fresh checkout would discard what the build produced.

- `actions/checkout` has run.
- `cargo` is on `PATH` (`actions-rust-lang/setup-rust-toolchain`, or whatever the build already used).
- `docker` is on `PATH` and the image exists locally, if `image` is set.

`jq` is **not** required. The shell versions of this check needed it, and an absent `jq` silently turned the label loop
into an unrun check reported as a passing image.

## Usage

### The whole check, after a build

```yaml
- uses: actions/checkout@<sha>

- uses: actions-rust-lang/setup-rust-toolchain@<sha>

- name: Build the image
  run: docker build -t myservice:test .

- name: Config contract
  uses: <owner>/actions/actions/rust/config-contract@<ref>
  with:
    features: config-schema
    image: myservice:test
```

Run it after the build and before the push, where a failure costs a retry instead of a release.

### Source only, in a job with no image

Each check is skipped by emptying its input, so a repository with no image, or no committed contract, takes only the half
that applies to it.

```yaml
- name: Config contract
  uses: <owner>/actions/actions/rust/config-contract@<ref>
  with:
    source_directory: services/api
    package: api-config
    features: config-schema
    image: '' # the default: no image checks
```

## Inputs

| Name               | Default                      | Description                                                                                |
| ------------------ | ---------------------------- | ------------------------------------------------------------------------------------------ |
| `source_directory` | `.`                          | Directory containing the Rust project. The generator runs here; `dockerfile` and `contract` resolve beneath it. |
| `example`          | `config-schema`              | The cargo example that renders the contract, built on `terrace_config::schema::cli::Cli`.   |
| `package`          | `''`                         | Workspace member owning the generator, passed to cargo as `-p`. Empty means the root package. |
| `features`         | `''`                         | Cargo features the generator needs. Comma- or whitespace-separated.                         |
| `dockerfile`       | `Dockerfile`                 | Dockerfile whose `terrace-config:labels` region is checked. Empty to skip.                  |
| `contract`         | `docs/config.contract.json`  | Committed contract document checked for drift. Empty to skip.                               |
| `image`            | `''`                         | Built image to inspect. Empty to skip both image checks.                                    |
| `contract_path`    | `/config/contract.json`      | Where the contract is embedded in the image. Must match the Dockerfile `COPY`.              |

Every one of these is validated before anything is read or run. The path inputs are confined to the checkout; `example`,
`package`, `features`, `image` and `contract_path` are confined to the grammars cargo and docker document, because they
become arguments to those tools and a workflow may pass `${{ github.event.* }}` into any of them.

## Outputs

| Name                | Description                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `checks_run`        | Space-separated ids of the checks that ran, in evaluation order.                                      |
| `checks_skipped`    | Space-separated ids of the checks whose input was empty.                                              |
| `contract_checksum` | SHA-256 of the generated contract, lowercase hex. Reproducible, so it identifies the configuration surface rather than the build. |
| `labels`            | The label set this contract publishes, as a JSON object — what a push step would have to apply.       |

Outputs are published on the failing run too, so a summary step can read them whatever the verdict.

## The Dockerfile region

The action cuts at the markers `--format dockerfile` emits, and compares the region including them:

```dockerfile
# terrace-config:labels:begin
LABEL dev.terrace.config.contract.version="1"
LABEL dev.terrace.config.contract.path="/config/contract.json"
LABEL dev.terrace.config.contract.digest="sha256:…"
# terrace-config:labels:end
```

A Dockerfile with no region, an unclosed region, an empty region or two regions is **refused, not skipped**. A Dockerfile
with no region is not one that passed — it is one where the generated block has nowhere to go.

## What it deliberately does not do

**It does not compare the in-image contract with a freshly generated one.** The copy inside an image carries the version,
revision and timestamp of the build that made it, so it is not the byte-reproducible copy the drift check uses. Comparing
the two needs an export from that same build (`--target contract-export`), which depends on the consumer's stage names.
So this checks the document is *there* and is a contract, and the full comparison stays in the repository's own build.
