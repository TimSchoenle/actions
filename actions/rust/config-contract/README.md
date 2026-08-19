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
   what is committed. A rendering that came out empty is refused. The generator is a cargo example or a cargo binary,
   and may take arguments of its own.
2. **Diffs every marked region of the Dockerfile** against the generated block, cut at the markers rather than by line
   count. A file with three runtime stages carries three regions, and each of them is compared.
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

### A generator that has to be a binary

`example` and `bin` are mutually exclusive, and naming both is refused rather than resolved by precedence. Naming
neither uses the example `config-schema`, which is what every workflow written before `bin` existed relies on.

```yaml
- name: Config contract
  uses: <owner>/actions/actions/rust/config-contract@<ref>
  with:
    bin: config-contract # a [[bin]], because other crates link it and the build runs the compiled artefact
    image: myservice:test
```

### A generator that renders more than one contract

A workspace publishing several images renders one contract per image, selected by an argument only that repository knows
the spelling of. `extra_args` carries it. The action checks **one** contract per invocation, so a repository with nine of
them runs the step nine times — in a matrix, or as nine steps in the job that already built the images:

```yaml
strategy:
  matrix:
    service: [api, bootstrap, worker]

steps:
  - name: Config contract
    uses: <owner>/actions/actions/rust/config-contract@<ref>
    with:
      bin: config-contract
      extra_args: --service ${{ matrix.service }}
      dockerfile: deploy/docker/Dockerfile
      contract: docs/contracts/${{ matrix.service }}.json
      image: ${{ matrix.service }}:test
```

`extra_args` is split shell-style — whitespace separates arguments, and `'` or `"` quote one containing spaces — into a
vector that no shell ever re-reads. There is no escape character: a backslash is an ordinary character, because it is one
in the Windows paths and regular expressions an argument may carry. `--format` and `--path` are the action's own and are
refused, in both the `--format labels` and `--format=labels` spellings, since a second spelling of either would leave the
action reporting on a rendering it did not ask for.

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
| `example`          | `''`                         | The cargo example that renders the contract, built on `terrace_config::schema::cli::Cli`. Mutually exclusive with `bin`; naming neither uses `config-schema`. |
| `bin`              | `''`                         | The cargo binary that renders the contract, for a generator that cannot be an example. Mutually exclusive with `example`. |
| `package`          | `''`                         | Workspace member owning the generator, passed to cargo as `-p`. Empty means the root package. |
| `features`         | `''`                         | Cargo features the generator needs. Comma- or whitespace-separated.                         |
| `dockerfile`       | `Dockerfile`                 | Dockerfile whose `terrace-config:labels` regions are checked. Empty to skip.                 |
| `contract`         | `docs/config.contract.json`  | Committed contract document checked for drift. Empty to skip.                               |
| `image`            | `''`                         | Built image to inspect. Empty to skip both image checks.                                    |
| `contract_path`    | `/config/contract.json`      | Where the contract is embedded in the image. Must match the Dockerfile `COPY`.              |
| `extra_args`       | `''`                         | Arguments for the generator itself, appended after `--format` and `--path`. Split shell-style into a vector. |

Every one of these is validated before anything is read or run. The path inputs are confined to the checkout; `example`,
`bin`, `package`, `features`, `image` and `contract_path` are confined to the grammars cargo and docker document, because
they become arguments to those tools and a workflow may pass `${{ github.event.* }}` into any of them.

`extra_args` is the one input whose grammar this action does not own — the arguments belong to a generator only the
calling repository knows. What is checked there is the *shape*: that the value becomes arguments rather than a command
line, that no argument holds a control character (a newline inside one would be a second line for the runner to read as a
workflow command), that it does not restate `--format` or `--path`, and that the list is bounded.

## Outputs

| Name                | Description                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `checks_run`        | Space-separated ids of the checks that ran, in evaluation order.                                      |
| `checks_skipped`    | Space-separated ids of the checks whose input was empty.                                              |
| `contract_checksum` | SHA-256 of the generated contract, lowercase hex. Reproducible, so it identifies the configuration surface rather than the build. |
| `labels`            | The label set this contract publishes, as a JSON object — what a push step would have to apply.       |

Outputs are published on the failing run too, so a summary step can read them whatever the verdict.

## The Dockerfile regions

The action cuts at the markers `--format dockerfile` emits, and compares each region including them:

```dockerfile
# terrace-config:labels:begin
LABEL dev.terrace.config.contract.version="1"
LABEL dev.terrace.config.contract.path="/config/contract.json"
LABEL dev.terrace.config.contract.digest="sha256:…"
# terrace-config:labels:end
```

A Dockerfile may carry **one or more** regions, because a Dockerfile may build more than one image: a file with three
runtime stages carries three `LABEL` blocks, and each is a place this contract is published from. Every region is
compared against the same generated block, every mismatch is reported, and each annotation is anchored to the line its
opening marker is on — so a file with three stages and one stale block says which one.

Refused, not skipped:

| Dockerfile                        | Why                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| no `:begin` marker                | The generated block has nowhere to go. Not a file that passed.                      |
| a `:begin` never closed by `:end` | Where the region ends is undecided.                                                 |
| a `:begin` inside an open region  | Where one region ends and the next begins is undecided.                             |
| more than 32 regions              | Every region is its own annotation, and this is past anything a Dockerfile builds.  |

A region holding nothing but its markers is a **finding on that region** rather than a refusal of the file: the other
regions are still worth comparing, and "this one is empty" is more use than a diff of the whole block against nothing.

A stray `:end` with nothing open is ignored. The opening marker is what defines a region, so a file carrying only a stray
closing one has no regions at all — which is what "carries no `:begin` marker" already says.

## What it deliberately does not do

**It does not compare the in-image contract with a freshly generated one.** The copy inside an image carries the version,
revision and timestamp of the build that made it, so it is not the byte-reproducible copy the drift check uses. Comparing
the two needs an export from that same build (`--target contract-export`), which depends on the consumer's stage names.
So this checks the document is *there* and is a contract, and the full comparison stays in the repository's own build.

That is a deliberate boundary rather than a gap waiting to be filled. A repository that also wants the in-image document
compared keeps that half in its own build, where the export stage it needs already exists, and still takes everything
else from here — including the check that the `contract_path` its own label advertises has a contract behind it.

**It checks one contract per invocation.** A workspace that renders several — one per published image — runs the step
once per contract, with `extra_args` selecting which. A list of contracts in one invocation was considered and rejected:
it would make `contract_checksum` and `labels` ambiguous outputs, and it would leave the Dockerfile regions with no way
to say which region belongs to which contract. A matrix answers both, in a form the annotations can be read against.
