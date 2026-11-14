# Changelog

## [1.1.2](https://github.com/TimSchoenle/actions/compare/src-actions-release-build-actions-v1.1.1...src-actions-release-build-actions-v1.1.2) (2026-11-13)


### Bug Fixes

* stop the auto-rebase listing from timing out, and retry transient GitHub 5xx on reads ([#2310](https://github.com/TimSchoenle/actions/issues/2310)) ([be1dbca](https://github.com/TimSchoenle/actions/commit/be1dbcab18907c8eafd4243402a258ed8383fbe2))

## [1.1.1](https://github.com/TimSchoenle/actions/compare/src-actions-release-build-actions-v1.1.0...src-actions-release-build-actions-v1.1.1) (2026-11-12)


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


### Code Refactoring

* **action-graph:** count the root tsconfig.json as a build input ([#2262](https://github.com/TimSchoenle/actions/issues/2262)) ([f8936a1](https://github.com/TimSchoenle/actions/commit/f8936a1bea59d13bb4028a33a9cd690e7d1000a8))

## [1.1.0](https://github.com/TimSchoenle/actions/compare/actions-release-build-actions-v1.0.0...actions-release-build-actions-v1.1.0) (2026-11-10)


### Features

* add the plan-release-please and publish-build-commit release actions ([#2065](https://github.com/TimSchoenle/actions/issues/2065)) ([e10ffab](https://github.com/TimSchoenle/actions/commit/e10ffab50c48a69190369a1d41f01f51431e3925))
* add the resolve-actions, build-actions and install-built-actions release actions ([#2064](https://github.com/TimSchoenle/actions/issues/2064)) ([a8df20c](https://github.com/TimSchoenle/actions/commit/a8df20c42ba849a4d8ea263c2143c80540d1689a))
