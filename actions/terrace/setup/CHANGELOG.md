# Changelog

## [3.1.3](https://github.com/TimSchoenle/actions/compare/actions-terrace-setup-v3.1.2...actions-terrace-setup-v3.1.3) (2026-11-10)


### Code Refactoring

* **common:** move the common actions off the toolkit's HTTP stack ([#2058](https://github.com/TimSchoenle/actions/issues/2058)) ([812d078](https://github.com/TimSchoenle/actions/commit/812d07807a9c34351af3e31e39248b85b8eeb282))
* move the remaining actions off the toolkit's HTTP stack ([#2059](https://github.com/TimSchoenle/actions/issues/2059)) ([55e9a9a](https://github.com/TimSchoenle/actions/commit/55e9a9a8ef8a7ee13fb4080c2c3b584d1bb94fea))
* **ts-util:** add a dependency-free actions runtime and a proxy-aware HTTP client ([#2057](https://github.com/TimSchoenle/actions/issues/2057)) ([23115ff](https://github.com/TimSchoenle/actions/commit/23115ff1123f61b51591663a15a3bae3ac79d4cb))

## [3.1.2](https://github.com/TimSchoenle/actions/compare/actions-terrace-setup-v3.1.1...actions-terrace-setup-v3.1.2) (2026-11-09)


### Dependencies

* **deps:** update typescript-eslint monorepo to v8.72.1 ([#2021](https://github.com/TimSchoenle/actions/issues/2021)) ([ad426da](https://github.com/TimSchoenle/actions/commit/ad426da610d733784d0b1b40a4f616ccc804cf08))

## [3.1.1](https://github.com/TimSchoenle/actions/compare/actions-terrace-setup-v3.1.0...actions-terrace-setup-v3.1.1) (2026-11-09)


### Dependencies

* **deps:** update vitest monorepo to v5.1.0 ([#2022](https://github.com/TimSchoenle/actions/issues/2022)) ([398bfe5](https://github.com/TimSchoenle/actions/commit/398bfe5214f00683881663c77507141906b14cd2))

## [3.1.0](https://github.com/TimSchoenle/actions/compare/actions-terrace-setup-v3.0.3...actions-terrace-setup-v3.1.0) (2026-11-09)


### Features

* **Actions/Download-Release-Asset:** add common/download-release-asset with a REST API fallback ([#2009](https://github.com/TimSchoenle/actions/issues/2009)) ([53e381e](https://github.com/TimSchoenle/actions/commit/53e381ec35093ab027629b1911b13b38f5e4ba7c))

## [3.0.3](https://github.com/TimSchoenle/actions/compare/actions-terrace-setup-v3.0.2...actions-terrace-setup-v3.0.3) (2026-11-07)


### Bug Fixes

* **scripts:** resolve bundled __dirname and __filename at runtime ([#1978](https://github.com/TimSchoenle/actions/issues/1978)) ([338c898](https://github.com/TimSchoenle/actions/commit/338c8988f33c1b2a065af602cc0a89cea66a04bd))

## [3.0.2](https://github.com/TimSchoenle/actions/compare/actions-terrace-setup-v3.0.1...actions-terrace-setup-v3.0.2) (2026-11-02)


### Dependencies

* **deps:** update dependency sigstore/cosign to v3.1.4 ([#1967](https://github.com/TimSchoenle/actions/issues/1967)) ([846aba8](https://github.com/TimSchoenle/actions/commit/846aba8c92d2112a76078733c193baa877eab073))

## [3.0.1](https://github.com/TimSchoenle/actions/compare/actions-terrace-setup-v3.0.0...actions-terrace-setup-v3.0.1) (2026-11-01)


### Dependencies

* **deps:** update dependency @types/node to v26.6.6 ([#1965](https://github.com/TimSchoenle/actions/issues/1965)) ([91142e4](https://github.com/TimSchoenle/actions/commit/91142e46ab7ae90184a53f659a536462361d21d3))
* **deps:** update dependency oras-project/oras to v1.3.6 ([#1960](https://github.com/TimSchoenle/actions/issues/1960)) ([240fa63](https://github.com/TimSchoenle/actions/commit/240fa6343290553560970d379a2243865b79d9e3))

## [3.0.0](https://github.com/TimSchoenle/actions/compare/actions-terrace-setup-v2.0.0...actions-terrace-setup-v3.0.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **Actions:** run every JavaScript action on node24 ([#1948](https://github.com/TimSchoenle/actions/issues/1948))

### Features

* **Actions:** run every JavaScript action on node24 ([#1948](https://github.com/TimSchoenle/actions/issues/1948)) ([344220d](https://github.com/TimSchoenle/actions/commit/344220d124144d170034a5edc83b43ed3a030367))

## [2.0.0](https://github.com/TimSchoenle/actions/compare/actions-terrace-setup-v1.1.0...actions-terrace-setup-v2.0.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **Actions/Auto-Approve-PR:** verify committer and signer, bind approval to the verified head ([#1935](https://github.com/TimSchoenle/actions/issues/1935))

### Bug Fixes

* **Actions/Auto-Approve-PR:** verify committer and signer, bind approval to the verified head ([#1935](https://github.com/TimSchoenle/actions/issues/1935)) ([124355a](https://github.com/TimSchoenle/actions/commit/124355a793ac1403e3a0aced050cab95d1278516))


### Dependencies

* **deps:** update dependency oras-project/oras to v1.3.5 ([#1921](https://github.com/TimSchoenle/actions/issues/1921)) ([3593fdf](https://github.com/TimSchoenle/actions/commit/3593fdf5a5b9f165556932a9afd511abf992f31c))

## [1.1.0](https://github.com/TimSchoenle/actions/compare/actions-terrace-setup-v1.0.0...actions-terrace-setup-v1.1.0) (2026-10-19)


### Features

* **Actions/Terrace-Setup:** add terrace/setup to install a verified terrace-contract ([#1895](https://github.com/TimSchoenle/actions/issues/1895)) ([2876df2](https://github.com/TimSchoenle/actions/commit/2876df214d88153960991db577fa1fa956ff3312))
