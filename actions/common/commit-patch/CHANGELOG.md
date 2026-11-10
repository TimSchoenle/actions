# Changelog

## [2.0.1](https://github.com/TimSchoenle/actions/compare/actions-common-commit-patch-v2.0.0...actions-common-commit-patch-v2.0.1) (2026-11-10)


### Code Refactoring

* **common:** move the common actions off the toolkit's HTTP stack ([#2058](https://github.com/TimSchoenle/actions/issues/2058)) ([812d078](https://github.com/TimSchoenle/actions/commit/812d07807a9c34351af3e31e39248b85b8eeb282))
* move the remaining actions off the toolkit's HTTP stack ([#2059](https://github.com/TimSchoenle/actions/issues/2059)) ([55e9a9a](https://github.com/TimSchoenle/actions/commit/55e9a9a8ef8a7ee13fb4080c2c3b584d1bb94fea))
* **ts-util:** add a dependency-free actions runtime and a proxy-aware HTTP client ([#2057](https://github.com/TimSchoenle/actions/issues/2057)) ([23115ff](https://github.com/TimSchoenle/actions/commit/23115ff1123f61b51591663a15a3bae3ac79d4cb))

## [2.0.0](https://github.com/TimSchoenle/actions/compare/actions-common-commit-patch-v1.3.1...actions-common-commit-patch-v2.0.0) (2026-11-09)


### ⚠ BREAKING CHANGES

* **trigger-coderabbit-review:** trigger from workflow_run and skip duplicate requests ([#2054](https://github.com/TimSchoenle/actions/issues/2054))

### Features

* **trigger-coderabbit-review:** trigger from workflow_run and skip duplicate requests ([#2054](https://github.com/TimSchoenle/actions/issues/2054)) ([e665b38](https://github.com/TimSchoenle/actions/commit/e665b387ceeeac72c08b9cbba172cd20598fefc2))


### Dependencies

* **deps:** update typescript-eslint monorepo to v8.72.1 ([#2021](https://github.com/TimSchoenle/actions/issues/2021)) ([ad426da](https://github.com/TimSchoenle/actions/commit/ad426da610d733784d0b1b40a4f616ccc804cf08))

## [1.3.1](https://github.com/TimSchoenle/actions/compare/actions-common-commit-patch-v1.3.0...actions-common-commit-patch-v1.3.1) (2026-11-09)


### Dependencies

* **deps:** update vitest monorepo to v5.1.0 ([#2022](https://github.com/TimSchoenle/actions/issues/2022)) ([398bfe5](https://github.com/TimSchoenle/actions/commit/398bfe5214f00683881663c77507141906b14cd2))

## [1.3.0](https://github.com/TimSchoenle/actions/compare/actions-common-commit-patch-v1.2.0...actions-common-commit-patch-v1.3.0) (2026-11-08)


### Features

* **common-find-patch:** add an action that finds a run's create-patch artifact without secrets ([#1990](https://github.com/TimSchoenle/actions/issues/1990)) ([e798e87](https://github.com/TimSchoenle/actions/commit/e798e87578c4f3481d3af1bc3ee9199e5072cc31))

## [1.2.0](https://github.com/TimSchoenle/actions/compare/actions-common-commit-patch-v1.1.1...actions-common-commit-patch-v1.2.0) (2026-11-07)


### Features

* **commit-patch:** download the patch from another run with run_id ([#1987](https://github.com/TimSchoenle/actions/issues/1987)) ([c56dac2](https://github.com/TimSchoenle/actions/commit/c56dac22f771b37a97872a2319ab32643d1f132c))

## [1.1.1](https://github.com/TimSchoenle/actions/compare/actions-common-commit-patch-v1.1.0...actions-common-commit-patch-v1.1.1) (2026-11-01)


### Dependencies

* **deps:** update dependency @types/node to v26.6.6 ([#1965](https://github.com/TimSchoenle/actions/issues/1965)) ([91142e4](https://github.com/TimSchoenle/actions/commit/91142e46ab7ae90184a53f659a536462361d21d3))

## [1.1.0](https://github.com/TimSchoenle/actions/compare/actions-common-commit-patch-v1.0.0...actions-common-commit-patch-v1.1.0) (2026-10-26)


### Features

* **common-commit-patch:** add create-patch and commit-patch so no job runs repository code beside a write token ([#1941](https://github.com/TimSchoenle/actions/issues/1941)) ([9ddd3ee](https://github.com/TimSchoenle/actions/commit/9ddd3eee018f08a3e7b10541708e3cb64c0b7efe))
