# Changelog

## [1.1.3](https://github.com/TimSchoenle/actions/compare/actions-common-find-patch-v1.1.2...actions-common-find-patch-v1.1.3) (2026-11-10)


### Bug Fixes

* **find-patch:** wait for this run's just-uploaded artifact to be listed ([#2061](https://github.com/TimSchoenle/actions/issues/2061)) ([88afd5a](https://github.com/TimSchoenle/actions/commit/88afd5a8fdd5a12c81a6679ef52d648c0317c2b5))


### Code Refactoring

* **common:** move the common actions off the toolkit's HTTP stack ([#2058](https://github.com/TimSchoenle/actions/issues/2058)) ([812d078](https://github.com/TimSchoenle/actions/commit/812d07807a9c34351af3e31e39248b85b8eeb282))
* move the remaining actions off the toolkit's HTTP stack ([#2059](https://github.com/TimSchoenle/actions/issues/2059)) ([55e9a9a](https://github.com/TimSchoenle/actions/commit/55e9a9a8ef8a7ee13fb4080c2c3b584d1bb94fea))
* **ts-util:** add a dependency-free actions runtime and a proxy-aware HTTP client ([#2057](https://github.com/TimSchoenle/actions/issues/2057)) ([23115ff](https://github.com/TimSchoenle/actions/commit/23115ff1123f61b51591663a15a3bae3ac79d4cb))

## [1.1.2](https://github.com/TimSchoenle/actions/compare/actions-common-find-patch-v1.1.1...actions-common-find-patch-v1.1.2) (2026-11-09)


### Dependencies

* **deps:** update typescript-eslint monorepo to v8.72.1 ([#2021](https://github.com/TimSchoenle/actions/issues/2021)) ([ad426da](https://github.com/TimSchoenle/actions/commit/ad426da610d733784d0b1b40a4f616ccc804cf08))

## [1.1.1](https://github.com/TimSchoenle/actions/compare/actions-common-find-patch-v1.1.0...actions-common-find-patch-v1.1.1) (2026-11-09)


### Dependencies

* **deps:** update vitest monorepo to v5.1.0 ([#2022](https://github.com/TimSchoenle/actions/issues/2022)) ([398bfe5](https://github.com/TimSchoenle/actions/commit/398bfe5214f00683881663c77507141906b14cd2))

## [1.1.0](https://github.com/TimSchoenle/actions/compare/actions-common-find-patch-v1.0.0...actions-common-find-patch-v1.1.0) (2026-11-08)


### Features

* **common-find-patch:** add an action that finds a run's create-patch artifact without secrets ([#1990](https://github.com/TimSchoenle/actions/issues/1990)) ([e798e87](https://github.com/TimSchoenle/actions/commit/e798e87578c4f3481d3af1bc3ee9199e5072cc31))
