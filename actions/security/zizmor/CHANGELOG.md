# Changelog

## [2.0.5](https://github.com/TimSchoenle/actions/compare/actions-security-zizmor-v2.0.4...actions-security-zizmor-v2.0.5) (2026-11-10)


### Code Refactoring

* **common:** move the common actions off the toolkit's HTTP stack ([#2058](https://github.com/TimSchoenle/actions/issues/2058)) ([812d078](https://github.com/TimSchoenle/actions/commit/812d07807a9c34351af3e31e39248b85b8eeb282))
* move the remaining actions off the toolkit's HTTP stack ([#2059](https://github.com/TimSchoenle/actions/issues/2059)) ([55e9a9a](https://github.com/TimSchoenle/actions/commit/55e9a9a8ef8a7ee13fb4080c2c3b584d1bb94fea))
* **ts-util:** add a dependency-free actions runtime and a proxy-aware HTTP client ([#2057](https://github.com/TimSchoenle/actions/issues/2057)) ([23115ff](https://github.com/TimSchoenle/actions/commit/23115ff1123f61b51591663a15a3bae3ac79d4cb))

## [2.0.4](https://github.com/TimSchoenle/actions/compare/actions-security-zizmor-v2.0.3...actions-security-zizmor-v2.0.4) (2026-11-09)


### Dependencies

* **deps:** update typescript-eslint monorepo to v8.72.1 ([#2021](https://github.com/TimSchoenle/actions/issues/2021)) ([ad426da](https://github.com/TimSchoenle/actions/commit/ad426da610d733784d0b1b40a4f616ccc804cf08))

## [2.0.3](https://github.com/TimSchoenle/actions/compare/actions-security-zizmor-v2.0.2...actions-security-zizmor-v2.0.3) (2026-11-09)


### Dependencies

* **deps:** update vitest monorepo to v5.1.0 ([#2022](https://github.com/TimSchoenle/actions/issues/2022)) ([398bfe5](https://github.com/TimSchoenle/actions/commit/398bfe5214f00683881663c77507141906b14cd2))

## [2.0.2](https://github.com/TimSchoenle/actions/compare/actions-security-zizmor-v2.0.1...actions-security-zizmor-v2.0.2) (2026-11-09)


### Dependencies

* **deps:** update all non-major action updates ([#1998](https://github.com/TimSchoenle/actions/issues/1998)) ([8002d47](https://github.com/TimSchoenle/actions/commit/8002d47b3051123182f5f290eb14ae4acf7cb876))
* **deps:** update ghcr.io/zizmorcore/zizmor docker tag to v1.32.0 ([#2005](https://github.com/TimSchoenle/actions/issues/2005)) ([c879754](https://github.com/TimSchoenle/actions/commit/c879754a274623aeb784c7c62e5eeebb42bfa5e0))

## [2.0.1](https://github.com/TimSchoenle/actions/compare/actions-security-zizmor-v2.0.0...actions-security-zizmor-v2.0.1) (2026-11-01)


### Dependencies

* **deps:** update dependency @types/node to v26.6.6 ([#1965](https://github.com/TimSchoenle/actions/issues/1965)) ([91142e4](https://github.com/TimSchoenle/actions/commit/91142e46ab7ae90184a53f659a536462361d21d3))

## [2.0.0](https://github.com/TimSchoenle/actions/compare/actions-security-zizmor-v1.1.3...actions-security-zizmor-v2.0.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **Actions/Auto-Approve-PR:** verify committer and signer, bind approval to the verified head ([#1935](https://github.com/TimSchoenle/actions/issues/1935))

### Bug Fixes

* **Actions/Auto-Approve-PR:** verify committer and signer, bind approval to the verified head ([#1935](https://github.com/TimSchoenle/actions/issues/1935)) ([124355a](https://github.com/TimSchoenle/actions/commit/124355a793ac1403e3a0aced050cab95d1278516))


### Dependencies

* **deps:** update all non-major action updates ([#1932](https://github.com/TimSchoenle/actions/issues/1932)) ([fa348bd](https://github.com/TimSchoenle/actions/commit/fa348bd12be1b57792078a445f050cfc721c69c1))

## [1.1.3](https://github.com/TimSchoenle/actions/compare/actions-security-zizmor-v1.1.2...actions-security-zizmor-v1.1.3) (2026-10-19)


### Dependencies

* **deps:** update github/codeql-action action to v4.39.0 ([#1896](https://github.com/TimSchoenle/actions/issues/1896)) ([bb97ac4](https://github.com/TimSchoenle/actions/commit/bb97ac4a238d26229383fa05b399527007c80c03))
* **deps:** update vitest monorepo to v5.0.5 ([#1893](https://github.com/TimSchoenle/actions/issues/1893)) ([4203cad](https://github.com/TimSchoenle/actions/commit/4203cadcad81743fffb9b5577b792d4f7cc6755f))

## [1.1.2](https://github.com/TimSchoenle/actions/compare/actions-security-zizmor-v1.1.1...actions-security-zizmor-v1.1.2) (2026-10-17)


### Dependencies

* **deps:** update ghcr.io/zizmorcore/zizmor docker tag to v1.31.1 ([#1869](https://github.com/TimSchoenle/actions/issues/1869)) ([648ea57](https://github.com/TimSchoenle/actions/commit/648ea57110a0e9ed596ca77fa5503180653cc9e9))
* **deps:** update vitest monorepo to v5.0.4 ([#1875](https://github.com/TimSchoenle/actions/issues/1875)) ([f1fd087](https://github.com/TimSchoenle/actions/commit/f1fd087ba71526256ab6d2f29e92d61c751675c8))

## [1.1.1](https://github.com/TimSchoenle/actions/compare/actions-security-zizmor-v1.1.0...actions-security-zizmor-v1.1.1) (2026-10-15)


### Dependencies

* **deps:** update dependency @types/node to v26.6.5 ([#1853](https://github.com/TimSchoenle/actions/issues/1853)) ([57df86d](https://github.com/TimSchoenle/actions/commit/57df86d54887c72d94867f77d17f45cdb2a6f016))
* **deps:** update dependency bun to v1.4.3 ([#1858](https://github.com/TimSchoenle/actions/issues/1858)) ([be4a7c7](https://github.com/TimSchoenle/actions/commit/be4a7c7cf344bc87659a6dd7dfdbd17b0768d2e5))
* **deps:** update ghcr.io/zizmorcore/zizmor docker tag to v1.31.0 ([#1859](https://github.com/TimSchoenle/actions/issues/1859)) ([978c61a](https://github.com/TimSchoenle/actions/commit/978c61aa574b0c8751cfec8847e44f605e5f526c))

## [1.1.0](https://github.com/TimSchoenle/actions/compare/actions-security-zizmor-v1.0.0...actions-security-zizmor-v1.1.0) (2026-10-12)


### Features

* **Actions/Security-Zizmor:** add zizmor action with strict collection and a findings gate ([#1848](https://github.com/TimSchoenle/actions/issues/1848)) ([98b8902](https://github.com/TimSchoenle/actions/commit/98b8902f9e8fd850f8aa1e9c34fcb43d7ef38d45))
