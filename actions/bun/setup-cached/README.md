# Bun Setup-cached

Installs a pinned Bun, restores `node_modules` from the Actions cache, runs `bun install --frozen-lockfile` and saves
the result when the cache missed and the job is allowed to write it.

## Usage

```yaml
- uses: actions/checkout@<sha>
  with:
    persist-credentials: false

- name: Setup Bun
  uses: <owner>/actions/actions/bun/setup-cached@<ref>
```

With no inputs the Bun version comes from `.bun-version`, and the cache is written only on trusted events (see
[Cache modes](#cache-modes)).

In a job that holds secrets, an App token or any write permission:

```yaml
- name: Setup Bun
  uses: <owner>/actions/actions/bun/setup-cached@<ref>
  with:
    cache-mode: none
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `bun-version` | `''` | Bun version to install, e.g. `1.3.0`. Wins over `bun-version-file`. |
| `bun-version-file` | `''` | File to read the version from, relative to the repository root: a file holding only the version (`.bun-version`), `.tool-versions`, or a `package.json` with `packageManager: "bun@<version>"` or `engines.bun`. |
| `working-directory` | `.` | Directory holding `package.json` and `bun.lock`. |
| `cache-mode` | `auto` | `auto`, `read-write`, `read-only` or `none`. Any other value fails the step. |
| `cache-key-prefix` | `''` | Prefix for the cache key. |

## Outputs

| Output | Description |
| --- | --- |
| `cache-hit` | `true` when `node_modules` was restored from an exact key match, otherwise `false` (always `false` for `none`). |
| `cache-key` | The cache key for this lockfile, also computed for `none`. |
| `cache-mode` | The mode the step ran with, with `auto` resolved. |

## Bun version

When neither `bun-version` nor `bun-version-file` is set, the step reads, in order:

1. `.bun-version` in `working-directory`
2. `package.json` in `working-directory`, when it names Bun in `packageManager` or `engines.bun`
3. `.bun-version` in the repository root

When none of them names a version, or a `bun-version-file` you named does not exist, the step fails. It never installs
the latest Bun without being told to: `bun-version: latest` still does that, explicitly.

## Cache modes

| Mode | Restores | Saves on a miss |
| --- | --- | --- |
| `read-write` | yes | yes |
| `read-only` | yes | no |
| `none` | no | no |
| `auto` | yes | only on `push`, `schedule`, `workflow_dispatch` and `merge_group` |

`auto` treats every other event, `pull_request` and `pull_request_target` among them, as `read-only`. A run on
`pull_request_target`, `workflow_run` or `issue_comment` saves into the base branch's cache scope, which every later
run on that branch restores. An entry saved by code from a pull request would then run in those later jobs.

### Why privileged jobs need `none`

A restored `node_modules` is code: the job runs it the moment it calls `bun`, a package script or a binary from
`node_modules/.bin`. `bun install --frozen-lockfile` checks that the tree matches `bun.lock`, but it does not re-hash the
contents of packages that are already installed, so a tampered entry under the right key passes. Caching Bun's global
store (`~/.bun/install/cache`) instead would not help, because `bun install` links from that store without re-verifying
package integrity either.

Any job that can run code can also save a cache entry, whatever the mode of this action, because the runner hands every
job the token that writes the cache. `read-only` therefore stops this job from poisoning the cache, but not from
running what another job saved. Use:

- `none` in any job that holds secrets, an App token, `id-token: write` or another write permission, for example
  release, publishing and maintenance jobs that push commits.
- `read-only` in jobs that run untrusted code and hold nothing worth stealing.
- `auto` (the default) or `read-write` in ordinary CI.

## Cache key

`<cache-key-prefix>bun-modules-v2-<runner.os>-<runner.arch>-<hash of bun.lock>`. The `v2` segment keeps this release
from restoring entries saved by earlier releases, which wrote from every event.

## Migrating from v1

- `bun-version` no longer defaults to `latest`. A repository without `.bun-version` (or a `package.json` naming Bun) now
  fails; add the file or pass `bun-version`.
- `bun-version-file` is honoured without also passing `bun-version: ''`.
- `cache-mode` defaults to `auto`, so `pull_request` runs no longer save the cache.
- The cache key changed, so the first run after upgrading misses.
