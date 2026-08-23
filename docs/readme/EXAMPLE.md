<!--
A finished README for a real repository, kept here as the target rather than a description of it.

It is TimSchoenle/Portfolio: a Rust Dioxus fullstack application with a Docker image and a Helm
chart. Every version, image name, licence identifier and configuration key below is interpolated
from the payload; none is typed. 248 lines, one H1, and both PROSE.md checks inside budget.

Read GUIDE.md for the rules this satisfies and PROSE.md for how its sentences are written.
Anything below this comment is the rendered output, unedited.
-->

<!--
Generated from .github/templates/README.md.hbs — edit that file, not this one.

CI renders it on every pull request and commits the result back to the branch. A push to `main`
whose README.md does not match its template fails the `readme` job in
.github/workflows/docs.yaml, which is a required check.

The payload comes from one command:

    cargo run -q -p portfolio-config --features config-schema \
      --example config-schema -- --format variables

Shared sections (banner, badges, install, compatibility, docs index, contributing, security,
licence) are partials from TimSchoenle/actions at templates/readme/, pinned by tag.

Nothing in this comment may contain a mustache that is not a real reference.
-->

# Portfolio

Dioxus fullstack (SSR + hydration) portfolio served by Axum.

[![Release](https://img.shields.io/github/v/release/TimSchoenle/Portfolio?sort=semver)](https://github.com/TimSchoenle/Portfolio/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/TimSchoenle/Portfolio/build.yaml?branch=main)](https://github.com/TimSchoenle/Portfolio/actions/workflows/build.yaml)
[![Site](https://img.shields.io/website?url=https%3A%2F%2Ftim-schoenle.de&label=tim-schoenle.de)](https://tim-schoenle.de)
[![License](https://img.shields.io/badge/license-Proprietary-blue)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-1.97-orange)](https://www.rust-lang.org)

## What this is

The source of [tim-schoenle.de](https://tim-schoenle.de), as one Rust workspace.

`apps/web` is a single crate with two feature-selected builds. The `server` build is an Axum
binary that renders HTML. The `web` build is a WASM bundle that takes over in the browser.

The configuration tables below are generated, not written. They come out of the Rust types that
load the configuration, as do `config.example.toml` and the image's contract labels, so renaming
a field corrects all three in the commit that renames it.

## Quick start

```bash
docker run --rm -p 8080:8080 timschoenle/portfolio:v2.7.1
```

Then open <http://localhost:8080>. The image is distroless, runs as `1001:1001`, and needs no
writable filesystem.

## Table of contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Operations](#operations)
- [Compatibility](#compatibility)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Features

- Every route renders on the server and then hydrates. Per-route `<head>` metadata and JSON-LD
  ship in the first response, and the locale is negotiated from request headers, so nothing
  arrives untranslated and gets swapped a moment later.
- EN and DE throughout, including both legal pages and both resumes. A unit test in
  `crates/data` fails the build when the two translation files disagree on a key.
- **Resumes are generated, not uploaded.** Typst typesets one A4 page per language, scaling the
  type down until the content fits, and stamps each PDF with a SHA-256 fingerprint that the
  contact card displays.
- **Content-Security-Policy is built per response.** The server hashes the inline scripts that
  document actually carries and reserves a nonce for the script Cloudflare injects at the edge.
  No `'unsafe-inline'`.
- `/licenses` lists every crate the client and the server link, the licence it ships under, and
  the verbatim text of every licence file found. cargo-about builds it during the image build.
- The project list is fetched from the GitHub API at build time, with archived, blacklisted and
  year-stale repositories dropped, then embedded into the binary by `build.rs`.
- Cmd+K opens a command palette with fuzzy search. The stack section is an interactive radar
  with per-skill tooltips and category filtering.

## Installation

### Docker

```bash
docker pull timschoenle/portfolio:v2.7.1
```

Published as a multi-platform manifest for `linux/amd64` and `linux/arm64`; Docker selects the
matching architecture. Pin by digest in production. The Helm chart does.

### Helm

```bash
helm repo add timschoenle https://timschoenle.github.io/helm-charts
helm install portfolio timschoenle/portfolio
```

Chart `portfolio` 5.1.4 tracks app version v2.7.1 and pins the image by digest. See
[the chart's values](https://github.com/TimSchoenle/helm-charts/tree/main/charts/portfolio).

### From source

```bash
rustup target add wasm32-unknown-unknown
cargo install dioxus-cli cargo-about --locked
git clone https://github.com/TimSchoenle/Portfolio.git
cd Portfolio
```

Node.js is required for the Tailwind step. `just` runs every recipe CI runs.

## Usage

Two artefacts have to exist before the web build, because `build.rs` embeds both: the resume
fingerprints and the licence inventory. Build them first.

```bash
just licenses                   # third-party licence inventory for /licenses
cargo run -p resume-generator   # resume/{en,de}.pdf + resume-fingerprint.json
dx serve --package web          # SSR + hydration on http://localhost:8080
```

Run the checks CI runs, in one recipe:

```bash
just verify            # fmt, lint, test
```

Refresh the project list from the GitHub API:

```bash
PORTFOLIO_GITHUB__TOKEN_FILE=/run/secrets/gh_token \
  cargo run --release -p update-repos
```

Without a token the run still works, against the anonymous rate limit.
[docs/PROJECT_DATA.md](docs/PROJECT_DATA.md) has the filtering rules and the `repos.json` schema.

## Configuration

Values are resolved in five layers, each overriding the one above it. If two sources supply the
same key and must not disagree, the load fails instead of picking one.

1. **Defaults** — the `Default` impl of each typed block.
2. **TOML** at `$PORTFOLIO_CONFIG` — a file, or every `*.toml` inside it when it names a directory.
3. **Environment** — `PORTFOLIO_`-prefixed variables, `__` for nesting.
4. **Secrets directory** at `$PORTFOLIO_SECRETS_DIR` — one file per key, named after it
   (`portfolio_github__token`). This is what a Kubernetes `Secret` volume mounts.
5. **File indirection** — `PORTFOLIO_<KEY>_FILE=/path` names a file holding the value.

The two variables the loader reads before any layer exists:

| Variable                | Role        | Default       | Purpose                                                                                                                  |
| ----------------------- | ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `PORTFOLIO_CONFIG`      | config      | `config.toml` | Names the TOML layer: a file, or a directory whose `*.toml` files are all merged in name order.                          |
| `PORTFOLIO_SECRETS_DIR` | secrets dir | —             | Names a directory of key-named files — a mounted Kubernetes `Secret` volume. Each file supplies the key its name spells. |

### Server

What the SSR server loads. Every environment spelling also accepts a `_FILE` suffix naming a
file that holds the value.

| TOML                           | Type      | Environment                                | Default                                    | Flags | Purpose                                                                                                                  |
| ------------------------------ | --------- | ------------------------------------------ | ------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| `assets.dist_dir`              | `PathBuf` | `PORTFOLIO_ASSETS__DIST_DIR`               | `public`                                   | —     | Directory holding the `dx bundle` output, relative to the working directory.                                             |
| `csp.hash_inline_scripts`      | `bool`    | `PORTFOLIO_CSP__HASH_INLINE_SCRIPTS`       | `true`                                     | —     | Hash every inline `<script>` in the document being served instead of admitting all inline script with `'unsafe-inline'`. |
| `csp.cloudflare.script_nonce`  | `bool`    | `PORTFOLIO_CSP__CLOUDFLARE__SCRIPT_NONCE`  | `true`                                     | —     | Reserve a per-response nonce in `script-src` for the script Cloudflare injects at the edge.                              |
| `csp.cloudflare.turnstile`     | `bool`    | `PORTFOLIO_CSP__CLOUDFLARE__TURNSTILE`     | `false`                                    | —     | Admit `https://challenges.cloudflare.com` in `script-src` and `frame-src`, for a Turnstile widget.                       |
| `csp.cloudflare.web_analytics` | `bool`    | `PORTFOLIO_CSP__CLOUDFLARE__WEB_ANALYTICS` | `false`                                    | —     | Admit the Cloudflare Web Analytics beacon and the endpoint it reports to.                                                |
| `isr.cache_dir`                | `PathBuf` | `PORTFOLIO_ISR__CACHE_DIR`                 | unset (ISR off; the image sets `/tmp/isr`) | —     | Writable directory rendered HTML is cached into. Unset or empty disables ISR.                                            |
| `isr.ttl_secs`                 | `u64`     | `PORTFOLIO_ISR__TTL_SECS`                  | `0` (permanent)                            | —     | Revalidation interval in seconds. Zero means a permanent cache.                                                          |

### Builder

What `update-repos` loads. It runs during the image build and exits. The server never reads
these keys, so a deployment needs no GitHub token. That is why there are two tables and not one.

| TOML              | Type           | Environment                  | Default                                         | Flags  | Purpose                                                                                     |
| ----------------- | -------------- | ---------------------------- | ----------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `github.username` | `String`       | `PORTFOLIO_GITHUB__USERNAME` | unset (the site's own `CONFIG.github_username`) | —      | User whose repositories to list.                                                            |
| `github.token`    | `SecretString` | `PORTFOLIO_GITHUB__TOKEN`    | unset                                           | secret | Bearer token lifting the GitHub API rate limit.                                             |
| `github.repos`    | `Vec<String>`  | `PORTFOLIO_GITHUB__REPOS`    | `[]` (every active repository the user owns)    | —      | Explicit repository set, bypassing the "every active repository" listing and its filtering. |

`github.token` is the only secret in the workspace. Supply it as a file, through `_FILE`
indirection or a secrets directory, so it never appears in a process listing or an image layer.
[`config.example.toml`](config.example.toml) carries every key with its default and is rendered
from the same payload as these tables.

## Operations

### Probes

| Endpoint                | Alias         | Purpose                                                                                                       |
| ----------------------- | ------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`       | —             | General health report with the current UTC time                                                               |
| `GET /api/health/live`  | `GET /livez`  | **Liveness** — process is running; failure restarts the container                                             |
| `GET /api/health/ready` | `GET /readyz` | **Readiness** — the client bundle is present and servable; failure removes the pod from the Service endpoints |

All probe responses are `no-store`. Readiness returns `503` until the assets are present.

### Runtime posture

The server reads only its bundle directory and writes only to stdout. It needs no writable
volume, not even `/tmp`, and runs under the restricted Pod Security Standard: numeric non-root
`1001:1001`, `readOnlyRootFilesystem`, no privilege escalation, all capabilities dropped,
`seccompProfile: RuntimeDefault`.

CSP construction, the security headers, the reproducible-build setup and the image's
self-describing config contract are documented in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/SECURITY_POSTURE.md](docs/SECURITY_POSTURE.md).

## Compatibility

|            | Supported                                |
| ---------- | ---------------------------------------- |
| Rust       | 1.97 (edition 2024)                      |
| Dioxus CLI | 0.7.9                                    |
| Platforms  | `linux/amd64`, `linux/arm64`             |
| Kubernetes | 1.28+ (restricted Pod Security Standard) |
| Helm chart | `timschoenle/portfolio` 5.1.4            |

## Documentation

| Document                                               | Purpose                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)           | The workspace: five crates, what each one owns, and why the web app is one crate with two feature-selected targets |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)               | Container, Helm, reproducible builds, and the image's config-contract labels                                       |
| [docs/SECURITY_POSTURE.md](docs/SECURITY_POSTURE.md)   | Content-Security-Policy construction, security headers, and the read-only runtime                                  |
| [docs/PROJECT_DATA.md](docs/PROJECT_DATA.md)           | How `repos.json` is built, filtered and embedded                                                                   |
| [docs/config.contract.json](docs/config.contract.json) | Machine-readable configuration contract, published on the image and checked by the chart's CI                      |

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the commit
convention and the `just verify` gate. Several files here are generated; each one says so in its
first few lines, and editing the output instead of the template will be reverted by CI.

## Security

Do not open a public issue for a vulnerability. [SECURITY.md](SECURITY.md) has the reporting
instructions and the supported versions.

## License

`LicenseRef-Proprietary`. The source is published to be read and to be run locally.
Redistribution and deployment are not granted. [LICENSE](LICENSE) has the terms.
