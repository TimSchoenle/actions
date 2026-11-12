# Changelog

## [4.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-terrace-setup-v3.1.3...src-actions-terrace-setup-v4.0.0) (2026-11-12)


### ⚠ BREAKING CHANGES

* **terrace-setup:** pin the SHA-256 of the cosign and oras checksum lists ([#2230](https://github.com/TimSchoenle/actions/issues/2230))

### Features

* **terrace-setup:** pin the SHA-256 of the cosign and oras checksum lists ([#2230](https://github.com/TimSchoenle/actions/issues/2230)) ([eafcf62](https://github.com/TimSchoenle/actions/commit/eafcf6294a55486145166a873716ef663cb55fbf))


### Bug Fixes

* **terrace-setup:** resolve a MAJOR.MINOR version from the line's tags, not the release list ([#2270](https://github.com/TimSchoenle/actions/issues/2270)) ([c4a110f](https://github.com/TimSchoenle/actions/commit/c4a110f016a8b55bb787c4872c0b3b4a142671e4))
* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))

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
