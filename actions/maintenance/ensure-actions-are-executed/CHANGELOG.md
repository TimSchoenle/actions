# Changelog

## [2.0.6](https://github.com/TimSchoenle/actions/compare/src-actions-maintenance-ensure-actions-are-executed-v2.0.5...src-actions-maintenance-ensure-actions-are-executed-v2.0.6) (2026-11-13)


### Bug Fixes

* stop the auto-rebase listing from timing out, and retry transient GitHub 5xx on reads ([#2310](https://github.com/TimSchoenle/actions/issues/2310)) ([be1dbca](https://github.com/TimSchoenle/actions/commit/be1dbcab18907c8eafd4243402a258ed8383fbe2))

## [2.0.5](https://github.com/TimSchoenle/actions/compare/src-actions-maintenance-ensure-actions-are-executed-v2.0.4...src-actions-maintenance-ensure-actions-are-executed-v2.0.5) (2026-11-12)


### Bug Fixes

* **ensure-actions-are-executed:** stop same-named checks masking a failure ([#2200](https://github.com/TimSchoenle/actions/issues/2200)) ([f0c9d55](https://github.com/TimSchoenle/actions/commit/f0c9d55d1077ec21482bc5fd8c2bcf2cb030fdd4))
* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))

## [2.0.4](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v2.0.3...actions-maintenance-ensure-actions-are-executed-v2.0.4) (2026-11-10)


### Code Refactoring

* **common:** move the common actions off the toolkit's HTTP stack ([#2058](https://github.com/TimSchoenle/actions/issues/2058)) ([812d078](https://github.com/TimSchoenle/actions/commit/812d07807a9c34351af3e31e39248b85b8eeb282))
* move the remaining actions off the toolkit's HTTP stack ([#2059](https://github.com/TimSchoenle/actions/issues/2059)) ([55e9a9a](https://github.com/TimSchoenle/actions/commit/55e9a9a8ef8a7ee13fb4080c2c3b584d1bb94fea))
* **ts-util:** add a dependency-free actions runtime and a proxy-aware HTTP client ([#2057](https://github.com/TimSchoenle/actions/issues/2057)) ([23115ff](https://github.com/TimSchoenle/actions/commit/23115ff1123f61b51591663a15a3bae3ac79d4cb))

## [2.0.3](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v2.0.2...actions-maintenance-ensure-actions-are-executed-v2.0.3) (2026-11-09)


### Dependencies

* **deps:** update typescript-eslint monorepo to v8.72.1 ([#2021](https://github.com/TimSchoenle/actions/issues/2021)) ([ad426da](https://github.com/TimSchoenle/actions/commit/ad426da610d733784d0b1b40a4f616ccc804cf08))

## [2.0.2](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v2.0.1...actions-maintenance-ensure-actions-are-executed-v2.0.2) (2026-11-09)


### Dependencies

* **deps:** update vitest monorepo to v5.1.0 ([#2022](https://github.com/TimSchoenle/actions/issues/2022)) ([398bfe5](https://github.com/TimSchoenle/actions/commit/398bfe5214f00683881663c77507141906b14cd2))

## [2.0.1](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v2.0.0...actions-maintenance-ensure-actions-are-executed-v2.0.1) (2026-11-01)


### Dependencies

* **deps:** update dependency @types/node to v26.6.6 ([#1965](https://github.com/TimSchoenle/actions/issues/1965)) ([91142e4](https://github.com/TimSchoenle/actions/commit/91142e46ab7ae90184a53f659a536462361d21d3))

## [2.0.0](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.5.9...actions-maintenance-ensure-actions-are-executed-v2.0.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **Actions:** run every JavaScript action on node24 ([#1948](https://github.com/TimSchoenle/actions/issues/1948))

### Features

* **Actions:** run every JavaScript action on node24 ([#1948](https://github.com/TimSchoenle/actions/issues/1948)) ([344220d](https://github.com/TimSchoenle/actions/commit/344220d124144d170034a5edc83b43ed3a030367))

## [1.5.9](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.5.8...actions-maintenance-ensure-actions-are-executed-v1.5.9) (2026-10-19)


### Dependencies

* **deps:** update vitest monorepo to v5.0.5 ([#1893](https://github.com/TimSchoenle/actions/issues/1893)) ([4203cad](https://github.com/TimSchoenle/actions/commit/4203cadcad81743fffb9b5577b792d4f7cc6755f))

## [1.5.8](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.5.7...actions-maintenance-ensure-actions-are-executed-v1.5.8) (2026-10-17)


### Dependencies

* **deps:** update vitest monorepo to v5.0.4 ([#1875](https://github.com/TimSchoenle/actions/issues/1875)) ([f1fd087](https://github.com/TimSchoenle/actions/commit/f1fd087ba71526256ab6d2f29e92d61c751675c8))

## [1.5.7](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.5.6...actions-maintenance-ensure-actions-are-executed-v1.5.7) (2026-10-15)


### Dependencies

* **deps:** update dependency @types/node to v26.6.5 ([#1853](https://github.com/TimSchoenle/actions/issues/1853)) ([57df86d](https://github.com/TimSchoenle/actions/commit/57df86d54887c72d94867f77d17f45cdb2a6f016))
* **deps:** update dependency bun to v1.4.3 ([#1858](https://github.com/TimSchoenle/actions/issues/1858)) ([be4a7c7](https://github.com/TimSchoenle/actions/commit/be4a7c7cf344bc87659a6dd7dfdbd17b0768d2e5))

## [1.5.6](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.5.5...actions-maintenance-ensure-actions-are-executed-v1.5.6) (2026-10-09)


### Bug Fixes

* **actions:** refuse symlinks that carry a path out of the workspace ([#1786](https://github.com/TimSchoenle/actions/issues/1786)) ([936deb8](https://github.com/TimSchoenle/actions/commit/936deb8b64e240c2ec14ead000f5cf995c1b75e6))

## [1.5.5](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.5.4...actions-maintenance-ensure-actions-are-executed-v1.5.5) (2026-10-06)


### Miscellaneous

* **deps:** update dependency @types/node to v26.6.4 ([#1777](https://github.com/TimSchoenle/actions/issues/1777)) ([481bf53](https://github.com/TimSchoenle/actions/commit/481bf536ec8ed826eeb5b5a80c457f8c815948fa))

## [1.5.4](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.5.3...actions-maintenance-ensure-actions-are-executed-v1.5.4) (2026-10-04)


### Miscellaneous

* **deps:** update vitest monorepo to v5.0.3 ([#1759](https://github.com/TimSchoenle/actions/issues/1759)) ([2747329](https://github.com/TimSchoenle/actions/commit/2747329bac8690cb7da29c31735874e4c83c7384))

## [1.5.3](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.5.2...actions-maintenance-ensure-actions-are-executed-v1.5.3) (2026-10-02)


### Miscellaneous

* **deps:** update dependency @types/node to v26.6.1 ([#1723](https://github.com/TimSchoenle/actions/issues/1723)) ([7e2332e](https://github.com/TimSchoenle/actions/commit/7e2332ef582f74d957ca5ec3b9913e3dd6e11c2e))
* **deps:** update dependency @types/node to v26.6.3 ([#1728](https://github.com/TimSchoenle/actions/issues/1728)) ([7307232](https://github.com/TimSchoenle/actions/commit/7307232c67390db5ecbeb5b444b048afdc24fb89))
* **deps:** update dependency fast-check to v4.10.1 ([#1717](https://github.com/TimSchoenle/actions/issues/1717)) ([12b58b6](https://github.com/TimSchoenle/actions/commit/12b58b6a7917f3308da59b5bd59fa1b649ddcfd2))
* **deps:** update dependency fast-check to v4.10.2 ([#1730](https://github.com/TimSchoenle/actions/issues/1730)) ([5dce227](https://github.com/TimSchoenle/actions/commit/5dce227fbce775d186af5dfb89d3f79f86be6a2f))
* **deps:** update dependency typescript to v7 ([#1143](https://github.com/TimSchoenle/actions/issues/1143)) ([98f1d03](https://github.com/TimSchoenle/actions/commit/98f1d03512a2223e231fe66291bf77a74ec640f1))
* **deps:** update vitest monorepo to v5.0.2 ([#1721](https://github.com/TimSchoenle/actions/issues/1721)) ([c0fb63e](https://github.com/TimSchoenle/actions/commit/c0fb63e2355714dae78131c3773b9184ec3f1fba))


### Dependencies

* **deps:** lock file maintenance ([#1725](https://github.com/TimSchoenle/actions/issues/1725)) ([82a5380](https://github.com/TimSchoenle/actions/commit/82a53807b20ab62253d6192aa52964a8417462f6))

## [1.5.2](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.5.1...actions-maintenance-ensure-actions-are-executed-v1.5.2) (2026-09-15)


### Bug Fixes

* **deps:** update dependency yaml to v2.9.1 ([#1684](https://github.com/TimSchoenle/actions/issues/1684)) ([f228af0](https://github.com/TimSchoenle/actions/commit/f228af08cc1a1eedaf5ab6a68925fcfbaeca7908))


### Miscellaneous

* **deps:** update dependency @fast-check/vitest to v0.5.0 ([#1681](https://github.com/TimSchoenle/actions/issues/1681)) ([d043758](https://github.com/TimSchoenle/actions/commit/d043758f87cfc78928358e9c06019af6e80615dd))
* **deps:** update dependency @types/node to v26.5.0 ([#1661](https://github.com/TimSchoenle/actions/issues/1661)) ([2923099](https://github.com/TimSchoenle/actions/commit/29230993e5ebf615ce70bde86cbdc4e1791b7adc))
* **deps:** update dependency fast-check to v4.10.0 ([#1682](https://github.com/TimSchoenle/actions/issues/1682)) ([aecb207](https://github.com/TimSchoenle/actions/commit/aecb207aa17ebd8035891d653e8735c7c5c44cd9))


### Dependencies

* **deps:** lock file maintenance ([#1680](https://github.com/TimSchoenle/actions/issues/1680)) ([a7d833d](https://github.com/TimSchoenle/actions/commit/a7d833dc40338a230a034935086cac940f34c7d9))

## [1.5.1](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.5.0...actions-maintenance-ensure-actions-are-executed-v1.5.1) (2026-09-10)


### Miscellaneous

* **deps:** update dependency @types/bun to v1.4.1 ([#1627](https://github.com/TimSchoenle/actions/issues/1627)) ([cebfecd](https://github.com/TimSchoenle/actions/commit/cebfecdc7a512c038bc658ab20bcc2df605af30f))

## [1.5.0](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.4.1...actions-maintenance-ensure-actions-are-executed-v1.5.0) (2026-09-07)


### Features

* **Action/Upsert-PrComment:** add new action ([#1620](https://github.com/TimSchoenle/actions/issues/1620)) ([9f1921a](https://github.com/TimSchoenle/actions/commit/9f1921a5628905bec449d714154a94bf22cf1107))


### Miscellaneous

* **deps:** update vitest monorepo to v5 ([#1619](https://github.com/TimSchoenle/actions/issues/1619)) ([9e0ec8d](https://github.com/TimSchoenle/actions/commit/9e0ec8d28fd551f5f9d6f3cb95c2c476e32d1f2a))

## [1.4.1](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.4.0...actions-maintenance-ensure-actions-are-executed-v1.4.1) (2026-09-04)


### Miscellaneous

* **deps:** update dependency @types/node to v26.4.1 ([#1599](https://github.com/TimSchoenle/actions/issues/1599)) ([c98ff8c](https://github.com/TimSchoenle/actions/commit/c98ff8c7d60e9f3056648b460e9eaefa8fdf04a1))

## [1.4.0](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.3.2...actions-maintenance-ensure-actions-are-executed-v1.4.0) (2026-08-30)


### Features

* defer and retry the work GitHub's rate limit refuses ([#1563](https://github.com/TimSchoenle/actions/issues/1563)) ([fe97452](https://github.com/TimSchoenle/actions/commit/fe9745292ab281cf31f2c62d7e93e5f0f6b15d2d))


### Bug Fixes

* survive the GitHub App rate limits that keep breaking CI ([#1558](https://github.com/TimSchoenle/actions/issues/1558)) ([fc8eb1c](https://github.com/TimSchoenle/actions/commit/fc8eb1c4a022605d9c0d3fcf17a3755816365b32))


### Miscellaneous

* **deps:** update dependency @types/node to v26.3.0 ([#1544](https://github.com/TimSchoenle/actions/issues/1544)) ([7999a4b](https://github.com/TimSchoenle/actions/commit/7999a4b5182f3240afd7e8b99a48b793ebd9ca42))
* **deps:** update dependency @types/node to v26.4.0 ([#1554](https://github.com/TimSchoenle/actions/issues/1554)) ([1750e5e](https://github.com/TimSchoenle/actions/commit/1750e5e356affe436dcf08ee5cc03e47232e230e))
* **deps:** update dependency bun to v1.4.0 ([#1528](https://github.com/TimSchoenle/actions/issues/1528)) ([a5b5384](https://github.com/TimSchoenle/actions/commit/a5b53841db8a5092c7df882f607b641f79d90b44))
* **deps:** update step-security/harden-runner action to v2.21.0 ([#1474](https://github.com/TimSchoenle/actions/issues/1474)) ([5f77c7a](https://github.com/TimSchoenle/actions/commit/5f77c7a65b4e99f62c9ecdeaa22766a35dc017c5))
* **deps:** update step-security/harden-runner action to v2.21.0 ([#1513](https://github.com/TimSchoenle/actions/issues/1513)) ([71715a0](https://github.com/TimSchoenle/actions/commit/71715a04001a9398d4f6baf46c8032c79d6836ff))
* **deps:** update vitest monorepo to v4.1.11 ([#1522](https://github.com/TimSchoenle/actions/issues/1522)) ([97d8a8c](https://github.com/TimSchoenle/actions/commit/97d8a8c31d16965ebb2336b6a0417582d4a2817c))


### Dependencies

* **deps:** lock file maintenance ([#1535](https://github.com/TimSchoenle/actions/issues/1535)) ([f822b27](https://github.com/TimSchoenle/actions/commit/f822b272bae418e4b0858c37df5812cfc5a6da9b))

## [1.3.2](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.3.1...actions-maintenance-ensure-actions-are-executed-v1.3.2) (2026-08-18)


### Dependencies

* **deps:** lock file maintenance ([#1452](https://github.com/TimSchoenle/actions/issues/1452)) ([c0d2560](https://github.com/TimSchoenle/actions/commit/c0d256049a03ea4fc29aba1d71b862e33f6d6429))

## [1.3.1](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.3.0...actions-maintenance-ensure-actions-are-executed-v1.3.1) (2026-08-12)


### Miscellaneous

* **deps:** update dependency @types/node to v26.2.0 ([#1401](https://github.com/TimSchoenle/actions/issues/1401)) ([047b6bb](https://github.com/TimSchoenle/actions/commit/047b6bb721b9f9b51b65f58fc7b9f1600dda00f2))

## [1.3.0](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.2.1...actions-maintenance-ensure-actions-are-executed-v1.3.0) (2026-08-05)


### Features

* **e2e:** add adversarial coverage and close four injection defects ([#1350](https://github.com/TimSchoenle/actions/issues/1350)) ([26b4c3f](https://github.com/TimSchoenle/actions/commit/26b4c3f084ff8dff395e98e35849d7e4b77b1159))


### CI

* rework e2e testing setup ([#1343](https://github.com/TimSchoenle/actions/issues/1343)) ([4f51f79](https://github.com/TimSchoenle/actions/commit/4f51f797ab8b92dab8dbf6c12f6eeb3b835bf661))


### Dependencies

* **deps:** lock file maintenance ([#1320](https://github.com/TimSchoenle/actions/issues/1320)) ([b3022a2](https://github.com/TimSchoenle/actions/commit/b3022a23f90829a884bfe11df468edaf17793109))

## [1.2.1](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.2.0...actions-maintenance-ensure-actions-are-executed-v1.2.1) (2026-07-30)


### Miscellaneous

* **deps:** update dependency @types/node to v26.1.2 ([#1286](https://github.com/TimSchoenle/actions/issues/1286)) ([16b9314](https://github.com/TimSchoenle/actions/commit/16b9314d882c59ccb836721935f0ae99a7ee7a51))


### Dependencies

* **deps:** lock file maintenance ([#1261](https://github.com/TimSchoenle/actions/issues/1261)) ([7ed82a2](https://github.com/TimSchoenle/actions/commit/7ed82a26b7944eff27b69f8482a13a21c128b036))

## [1.2.0](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.1.1...actions-maintenance-ensure-actions-are-executed-v1.2.0) (2026-07-17)


### Features

* add proper retry logic for github api interaction ([#1203](https://github.com/TimSchoenle/actions/issues/1203)) ([36d3bd2](https://github.com/TimSchoenle/actions/commit/36d3bd20f1bc82ddeed6bbd2fc6c07cc37f577ff))


### Bug Fixes

* **deps:** update dependency yaml to v2.9.0 ([#1196](https://github.com/TimSchoenle/actions/issues/1196)) ([9967707](https://github.com/TimSchoenle/actions/commit/9967707573379fc0c63567b3f6c1aee584855f80))


### Code Refactoring

* migrate more actions to TS ([#1188](https://github.com/TimSchoenle/actions/issues/1188)) ([6af61e0](https://github.com/TimSchoenle/actions/commit/6af61e08981d32eaea16e58dac1f3eeb3ff5d95a))
* migrate more actions to TS ([#1198](https://github.com/TimSchoenle/actions/issues/1198)) ([140f384](https://github.com/TimSchoenle/actions/commit/140f3848c2f53c3a10830d89e4654495eba64950))


### Build System

* standardize action build process ([#1204](https://github.com/TimSchoenle/actions/issues/1204)) ([3c469b0](https://github.com/TimSchoenle/actions/commit/3c469b0bc9a0a91d00d3df0af095bb19ae769582))

## [1.1.1](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.1.0...actions-maintenance-ensure-actions-are-executed-v1.1.1) (2026-07-09)


### Bug Fixes

* **Actions/Ensure-Executed:** jq argument limit ([#1138](https://github.com/TimSchoenle/actions/issues/1138)) ([95478a3](https://github.com/TimSchoenle/actions/commit/95478a31a6d4cc610d7e059ec26f64d803604bb4))

## [1.1.0](https://github.com/TimSchoenle/actions/compare/actions-maintenance-ensure-actions-are-executed-v1.0.0...actions-maintenance-ensure-actions-are-executed-v1.1.0) (2026-03-30)


### Features

* **Actions:** add new requiered action helper ([#703](https://github.com/TimSchoenle/actions/issues/703)) ([9db65af](https://github.com/TimSchoenle/actions/commit/9db65afc01347a2ad28ca0d226ea584d00d91325))
