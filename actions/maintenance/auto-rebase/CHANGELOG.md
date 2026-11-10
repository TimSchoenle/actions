# Changelog

## [3.0.4](https://github.com/TimSchoenle/actions/compare/actions-maintenance-auto-rebase-v3.0.3...actions-maintenance-auto-rebase-v3.0.4) (2026-11-10)


### Code Refactoring

* **common:** move the common actions off the toolkit's HTTP stack ([#2058](https://github.com/TimSchoenle/actions/issues/2058)) ([812d078](https://github.com/TimSchoenle/actions/commit/812d07807a9c34351af3e31e39248b85b8eeb282))
* move the remaining actions off the toolkit's HTTP stack ([#2059](https://github.com/TimSchoenle/actions/issues/2059)) ([55e9a9a](https://github.com/TimSchoenle/actions/commit/55e9a9a8ef8a7ee13fb4080c2c3b584d1bb94fea))
* **ts-util:** add a dependency-free actions runtime and a proxy-aware HTTP client ([#2057](https://github.com/TimSchoenle/actions/issues/2057)) ([23115ff](https://github.com/TimSchoenle/actions/commit/23115ff1123f61b51591663a15a3bae3ac79d4cb))

## [3.0.3](https://github.com/TimSchoenle/actions/compare/actions-maintenance-auto-rebase-v3.0.2...actions-maintenance-auto-rebase-v3.0.3) (2026-11-09)


### Dependencies

* **deps:** update typescript-eslint monorepo to v8.72.1 ([#2021](https://github.com/TimSchoenle/actions/issues/2021)) ([ad426da](https://github.com/TimSchoenle/actions/commit/ad426da610d733784d0b1b40a4f616ccc804cf08))

## [3.0.2](https://github.com/TimSchoenle/actions/compare/actions-maintenance-auto-rebase-v3.0.1...actions-maintenance-auto-rebase-v3.0.2) (2026-11-09)


### Dependencies

* **deps:** update vitest monorepo to v5.1.0 ([#2022](https://github.com/TimSchoenle/actions/issues/2022)) ([398bfe5](https://github.com/TimSchoenle/actions/commit/398bfe5214f00683881663c77507141906b14cd2))

## [3.0.1](https://github.com/TimSchoenle/actions/compare/actions-maintenance-auto-rebase-v3.0.0...actions-maintenance-auto-rebase-v3.0.1) (2026-11-01)


### Dependencies

* **deps:** update dependency @types/node to v26.6.6 ([#1965](https://github.com/TimSchoenle/actions/issues/1965)) ([91142e4](https://github.com/TimSchoenle/actions/commit/91142e46ab7ae90184a53f659a536462361d21d3))

## [3.0.0](https://github.com/TimSchoenle/actions/compare/actions-maintenance-auto-rebase-v2.0.0...actions-maintenance-auto-rebase-v3.0.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **Actions:** run every JavaScript action on node24 ([#1948](https://github.com/TimSchoenle/actions/issues/1948))

### Features

* **Actions:** run every JavaScript action on node24 ([#1948](https://github.com/TimSchoenle/actions/issues/1948)) ([344220d](https://github.com/TimSchoenle/actions/commit/344220d124144d170034a5edc83b43ed3a030367))

## [2.0.0](https://github.com/TimSchoenle/actions/compare/actions-maintenance-auto-rebase-v1.0.0...actions-maintenance-auto-rebase-v2.0.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **Actions/Auto-Approve-PR:** verify committer and signer, bind approval to the verified head ([#1935](https://github.com/TimSchoenle/actions/issues/1935))

### Features

* **Actions/Maintenance:** add wipe-cache and auto-rebase actions to replace the reusable workflows ([#1936](https://github.com/TimSchoenle/actions/issues/1936)) ([1c1e26a](https://github.com/TimSchoenle/actions/commit/1c1e26a10ff3d9ce83a2219ffe72845d0944028d))


### Bug Fixes

* **Actions/Auto-Approve-PR:** verify committer and signer, bind approval to the verified head ([#1935](https://github.com/TimSchoenle/actions/issues/1935)) ([124355a](https://github.com/TimSchoenle/actions/commit/124355a793ac1403e3a0aced050cab95d1278516))
