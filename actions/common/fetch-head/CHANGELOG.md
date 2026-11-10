# Changelog

## [2.0.1](https://github.com/TimSchoenle/actions/compare/actions-common-fetch-head-v2.0.0...actions-common-fetch-head-v2.0.1) (2026-11-10)


### Code Refactoring

* **common:** move the common actions off the toolkit's HTTP stack ([#2058](https://github.com/TimSchoenle/actions/issues/2058)) ([812d078](https://github.com/TimSchoenle/actions/commit/812d07807a9c34351af3e31e39248b85b8eeb282))
* move the remaining actions off the toolkit's HTTP stack ([#2059](https://github.com/TimSchoenle/actions/issues/2059)) ([55e9a9a](https://github.com/TimSchoenle/actions/commit/55e9a9a8ef8a7ee13fb4080c2c3b584d1bb94fea))
* **ts-util:** add a dependency-free actions runtime and a proxy-aware HTTP client ([#2057](https://github.com/TimSchoenle/actions/issues/2057)) ([23115ff](https://github.com/TimSchoenle/actions/commit/23115ff1123f61b51591663a15a3bae3ac79d4cb))

## [2.0.0](https://github.com/TimSchoenle/actions/compare/actions-common-fetch-head-v1.1.1...actions-common-fetch-head-v2.0.0) (2026-11-09)


### ⚠ BREAKING CHANGES

* **trigger-coderabbit-review:** trigger from workflow_run and skip duplicate requests ([#2054](https://github.com/TimSchoenle/actions/issues/2054))

### Features

* **trigger-coderabbit-review:** trigger from workflow_run and skip duplicate requests ([#2054](https://github.com/TimSchoenle/actions/issues/2054)) ([e665b38](https://github.com/TimSchoenle/actions/commit/e665b387ceeeac72c08b9cbba172cd20598fefc2))


### Dependencies

* **deps:** update typescript-eslint monorepo to v8.72.1 ([#2021](https://github.com/TimSchoenle/actions/issues/2021)) ([ad426da](https://github.com/TimSchoenle/actions/commit/ad426da610d733784d0b1b40a4f616ccc804cf08))

## [1.1.1](https://github.com/TimSchoenle/actions/compare/actions-common-fetch-head-v1.1.0...actions-common-fetch-head-v1.1.1) (2026-11-09)


### Dependencies

* **deps:** update vitest monorepo to v5.1.0 ([#2022](https://github.com/TimSchoenle/actions/issues/2022)) ([398bfe5](https://github.com/TimSchoenle/actions/commit/398bfe5214f00683881663c77507141906b14cd2))

## [1.1.0](https://github.com/TimSchoenle/actions/compare/actions-common-fetch-head-v1.0.0...actions-common-fetch-head-v1.1.0) (2026-11-09)


### Features

* **common-fetch-head:** add an action that fetches one commit without checking it out ([#2015](https://github.com/TimSchoenle/actions/issues/2015)) ([abdaf4e](https://github.com/TimSchoenle/actions/commit/abdaf4e5198612f7029c099e4c938e920aa2399a))
