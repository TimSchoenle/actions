# Changelog

## [1.3.2](https://github.com/TimSchoenle/actions/compare/actions-common-commit-changes-v1.3.1...actions-common-commit-changes-v1.3.2) (2026-08-18)


### Dependencies

* **deps:** lock file maintenance ([#1452](https://github.com/TimSchoenle/actions/issues/1452)) ([c0d2560](https://github.com/TimSchoenle/actions/commit/c0d256049a03ea4fc29aba1d71b862e33f6d6429))

## [1.3.1](https://github.com/TimSchoenle/actions/compare/actions-common-commit-changes-v1.3.0...actions-common-commit-changes-v1.3.1) (2026-08-12)


### Miscellaneous

* **deps:** update dependency @types/node to v26.2.0 ([#1401](https://github.com/TimSchoenle/actions/issues/1401)) ([047b6bb](https://github.com/TimSchoenle/actions/commit/047b6bb721b9f9b51b65f58fc7b9f1600dda00f2))

## [1.3.0](https://github.com/TimSchoenle/actions/compare/actions-common-commit-changes-v1.2.2...actions-common-commit-changes-v1.3.0) (2026-08-04)


### Features

* **e2e:** add adversarial coverage and close four injection defects ([#1350](https://github.com/TimSchoenle/actions/issues/1350)) ([26b4c3f](https://github.com/TimSchoenle/actions/commit/26b4c3f084ff8dff395e98e35849d7e4b77b1159))


### CI

* rework e2e testing setup ([#1343](https://github.com/TimSchoenle/actions/issues/1343)) ([4f51f79](https://github.com/TimSchoenle/actions/commit/4f51f797ab8b92dab8dbf6c12f6eeb3b835bf661))

## [1.2.2](https://github.com/TimSchoenle/actions/compare/actions-common-commit-changes-v1.2.1...actions-common-commit-changes-v1.2.2) (2026-08-03)


### Bug Fixes

* **Actions/CommitChanges:** github network delay edge case ([3713d44](https://github.com/TimSchoenle/actions/commit/3713d44de9d7e060f46bdd84ecfa24f545cd8287))


### Dependencies

* **deps:** lock file maintenance ([#1320](https://github.com/TimSchoenle/actions/issues/1320)) ([b3022a2](https://github.com/TimSchoenle/actions/commit/b3022a23f90829a884bfe11df468edaf17793109))

## [1.2.1](https://github.com/TimSchoenle/actions/compare/actions-common-commit-changes-v1.2.0...actions-common-commit-changes-v1.2.1) (2026-07-31)


### Miscellaneous

* **deps:** update dependency @types/node to v26.1.2 ([#1286](https://github.com/TimSchoenle/actions/issues/1286)) ([16b9314](https://github.com/TimSchoenle/actions/commit/16b9314d882c59ccb836721935f0ae99a7ee7a51))


### Dependencies

* **deps:** lock file maintenance ([#1261](https://github.com/TimSchoenle/actions/issues/1261)) ([7ed82a2](https://github.com/TimSchoenle/actions/commit/7ed82a26b7944eff27b69f8482a13a21c128b036))

## [1.2.0](https://github.com/TimSchoenle/actions/compare/actions-common-commit-changes-v1.1.5...actions-common-commit-changes-v1.2.0) (2026-07-17)


### Features

* add proper retry logic for github api interaction ([#1203](https://github.com/TimSchoenle/actions/issues/1203)) ([36d3bd2](https://github.com/TimSchoenle/actions/commit/36d3bd20f1bc82ddeed6bbd2fc6c07cc37f577ff))


### Code Refactoring

* migrate more actions to TS ([#1198](https://github.com/TimSchoenle/actions/issues/1198)) ([140f384](https://github.com/TimSchoenle/actions/commit/140f3848c2f53c3a10830d89e4654495eba64950))


### Build System

* standardize action build process ([#1204](https://github.com/TimSchoenle/actions/issues/1204)) ([3c469b0](https://github.com/TimSchoenle/actions/commit/3c469b0bc9a0a91d00d3df0af095bb19ae769582))

## [1.1.5](https://github.com/TimSchoenle/actions/compare/actions-common-commit-changes-v1.1.4...actions-common-commit-changes-v1.1.5) (2026-06-27)


### Miscellaneous

* **deps:** update all non-major action updates to v2.79.15 ([#981](https://github.com/TimSchoenle/actions/issues/981)) ([710dc9c](https://github.com/TimSchoenle/actions/commit/710dc9c4a2fe1e186af4b58c3df93ce6afc9d9ba))

## [1.1.4](https://github.com/TimSchoenle/actions/compare/actions-common-commit-changes-v1.1.3...actions-common-commit-changes-v1.1.4) (2026-02-12)


### Bug Fixes

* **Actions/Commit-Changes:** rewrite path handlers to hopefully handle edge cases ([#405](https://github.com/TimSchoenle/actions/issues/405)) ([58c8ce5](https://github.com/TimSchoenle/actions/commit/58c8ce514561fddb56c3f7ad350ac6ee8c61f5d9))

## [1.1.3](https://github.com/TimSchoenle/actions/compare/actions-common-commit-changes-v1.1.2...actions-common-commit-changes-v1.1.3) (2026-02-11)


### Bug Fixes

* **Actions/Commit-Changes:** fix file pattern support ([#400](https://github.com/TimSchoenle/actions/issues/400)) ([c5fa9cc](https://github.com/TimSchoenle/actions/commit/c5fa9ccf31b3499b372cb964e43ac62520b62ec0))

## [1.1.2](https://github.com/TimSchoenle/actions/compare/actions-common-commit-changes-v1.1.1...actions-common-commit-changes-v1.1.2) (2026-02-09)


### Bug Fixes

* **Actions/Commit-Changes:** improve empty PR detection ([#376](https://github.com/TimSchoenle/actions/issues/376)) ([57d48d0](https://github.com/TimSchoenle/actions/commit/57d48d09b9f2ea68ac8e323a62ee6748e3812b91))

## [1.1.1](https://github.com/TimSchoenle/actions/compare/actions-common-commit-changes-v1.1.0...actions-common-commit-changes-v1.1.1) (2026-01-12)


### Bug Fixes

* **Actions:** standardize arg names ([#164](https://github.com/TimSchoenle/actions/issues/164)) ([13c5d00](https://github.com/TimSchoenle/actions/commit/13c5d00d765c6582842d1b4eb22eebf4bc27be6c))

## [1.1.0](https://github.com/TimSchoenle/actions/compare/actions-common-commit-changes-v1.0.0...actions-common-commit-changes-v1.1.0) (2026-01-12)


### Features

* **Actions:** implement common commit-changes with opinionated defaults ([#161](https://github.com/TimSchoenle/actions/issues/161)) ([579eff6](https://github.com/TimSchoenle/actions/commit/579eff6de279c9894d64ccbb4ecf91c6e13eff07))
