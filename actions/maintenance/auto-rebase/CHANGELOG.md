# Changelog

## [4.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-maintenance-auto-rebase-v3.0.5...src-actions-maintenance-auto-rebase-v4.0.0) (2026-11-12)


### ⚠ BREAKING CHANGES

* **auto-rebase:** refuse a pull request page that cannot advance ([#2282](https://github.com/TimSchoenle/actions/issues/2282))

### Features

* **auto-rebase:** update only behind pull requests, oldest first, with only_auto_merge and limit ([#2276](https://github.com/TimSchoenle/actions/issues/2276)) ([ecf98d0](https://github.com/TimSchoenle/actions/commit/ecf98d0ab063a798391612627f943b84a68fbff9))


### Bug Fixes

* **auto-rebase:** refuse a pull request page that cannot advance ([#2282](https://github.com/TimSchoenle/actions/issues/2282)) ([9850af0](https://github.com/TimSchoenle/actions/commit/9850af0767637d52e6555ec0492b761db7702e16))

## [3.0.5](https://github.com/TimSchoenle/actions/compare/src-actions-maintenance-auto-rebase-v3.0.4...src-actions-maintenance-auto-rebase-v3.0.5) (2026-11-12)


### Bug Fixes

* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))

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
