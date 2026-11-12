# Changelog

## [1.1.11](https://github.com/TimSchoenle/actions/compare/src-actions-security-codeql-v1.1.10...src-actions-security-codeql-v1.1.11) (2026-11-12)


### Bug Fixes

* **codeql:** exclude no test path when analysing the actions language ([#2206](https://github.com/TimSchoenle/actions/issues/2206)) ([640285d](https://github.com/TimSchoenle/actions/commit/640285d98ae77b584d90ba6567425fdcb6b012b6))
* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))

## [1.1.10](https://github.com/TimSchoenle/actions/compare/actions-security-codeql-v1.1.9...actions-security-codeql-v1.1.10) (2026-11-10)


### Code Refactoring

* **common:** move the common actions off the toolkit's HTTP stack ([#2058](https://github.com/TimSchoenle/actions/issues/2058)) ([812d078](https://github.com/TimSchoenle/actions/commit/812d07807a9c34351af3e31e39248b85b8eeb282))
* move the remaining actions off the toolkit's HTTP stack ([#2059](https://github.com/TimSchoenle/actions/issues/2059)) ([55e9a9a](https://github.com/TimSchoenle/actions/commit/55e9a9a8ef8a7ee13fb4080c2c3b584d1bb94fea))
* **ts-util:** add a dependency-free actions runtime and a proxy-aware HTTP client ([#2057](https://github.com/TimSchoenle/actions/issues/2057)) ([23115ff](https://github.com/TimSchoenle/actions/commit/23115ff1123f61b51591663a15a3bae3ac79d4cb))

## [1.1.9](https://github.com/TimSchoenle/actions/compare/actions-security-codeql-v1.1.8...actions-security-codeql-v1.1.9) (2026-11-09)


### Dependencies

* **deps:** update typescript-eslint monorepo to v8.72.1 ([#2021](https://github.com/TimSchoenle/actions/issues/2021)) ([ad426da](https://github.com/TimSchoenle/actions/commit/ad426da610d733784d0b1b40a4f616ccc804cf08))

## [1.1.8](https://github.com/TimSchoenle/actions/compare/actions-security-codeql-v1.1.7...actions-security-codeql-v1.1.8) (2026-11-09)


### Dependencies

* **deps:** update vitest monorepo to v5.1.0 ([#2022](https://github.com/TimSchoenle/actions/issues/2022)) ([398bfe5](https://github.com/TimSchoenle/actions/commit/398bfe5214f00683881663c77507141906b14cd2))

## [1.1.7](https://github.com/TimSchoenle/actions/compare/actions-security-codeql-v1.1.6...actions-security-codeql-v1.1.7) (2026-11-09)


### Dependencies

* **deps:** update all non-major action updates ([#1998](https://github.com/TimSchoenle/actions/issues/1998)) ([8002d47](https://github.com/TimSchoenle/actions/commit/8002d47b3051123182f5f290eb14ae4acf7cb876))

## [1.1.6](https://github.com/TimSchoenle/actions/compare/actions-security-codeql-v1.1.5...actions-security-codeql-v1.1.6) (2026-11-01)


### Dependencies

* **deps:** update dependency @types/node to v26.6.6 ([#1965](https://github.com/TimSchoenle/actions/issues/1965)) ([91142e4](https://github.com/TimSchoenle/actions/commit/91142e46ab7ae90184a53f659a536462361d21d3))

## [1.1.5](https://github.com/TimSchoenle/actions/compare/actions-security-codeql-v1.1.4...actions-security-codeql-v1.1.5) (2026-10-26)


### Dependencies

* **deps:** update all non-major action updates ([#1932](https://github.com/TimSchoenle/actions/issues/1932)) ([fa348bd](https://github.com/TimSchoenle/actions/commit/fa348bd12be1b57792078a445f050cfc721c69c1))

## [1.1.4](https://github.com/TimSchoenle/actions/compare/actions-security-codeql-v1.1.3...actions-security-codeql-v1.1.4) (2026-10-19)


### Dependencies

* **deps:** update github/codeql-action action to v4.39.0 ([#1896](https://github.com/TimSchoenle/actions/issues/1896)) ([bb97ac4](https://github.com/TimSchoenle/actions/commit/bb97ac4a238d26229383fa05b399527007c80c03))
* **deps:** update vitest monorepo to v5.0.5 ([#1893](https://github.com/TimSchoenle/actions/issues/1893)) ([4203cad](https://github.com/TimSchoenle/actions/commit/4203cadcad81743fffb9b5577b792d4f7cc6755f))

## [1.1.3](https://github.com/TimSchoenle/actions/compare/actions-security-codeql-v1.1.2...actions-security-codeql-v1.1.3) (2026-10-17)


### Dependencies

* **deps:** update vitest monorepo to v5.0.4 ([#1875](https://github.com/TimSchoenle/actions/issues/1875)) ([f1fd087](https://github.com/TimSchoenle/actions/commit/f1fd087ba71526256ab6d2f29e92d61c751675c8))

## [1.1.2](https://github.com/TimSchoenle/actions/compare/actions-security-codeql-v1.1.1...actions-security-codeql-v1.1.2) (2026-10-15)


### Bug Fixes

* **actions/common/close-pull-request:** treat a PR closed by base-branch deletion as closed ([#1857](https://github.com/TimSchoenle/actions/issues/1857)) ([a18dbef](https://github.com/TimSchoenle/actions/commit/a18dbef1932a4b4fd0b39d52260f93531ec25bcd))


### Dependencies

* **deps:** update dependency @types/node to v26.6.5 ([#1853](https://github.com/TimSchoenle/actions/issues/1853)) ([57df86d](https://github.com/TimSchoenle/actions/commit/57df86d54887c72d94867f77d17f45cdb2a6f016))
* **deps:** update dependency bun to v1.4.3 ([#1858](https://github.com/TimSchoenle/actions/issues/1858)) ([be4a7c7](https://github.com/TimSchoenle/actions/commit/be4a7c7cf344bc87659a6dd7dfdbd17b0768d2e5))

## [1.1.1](https://github.com/TimSchoenle/actions/compare/actions-security-codeql-v1.1.0...actions-security-codeql-v1.1.1) (2026-10-12)


### Bug Fixes

* **actions:** strip the byte order marks that hid files from zizmor ([#1845](https://github.com/TimSchoenle/actions/issues/1845)) ([41f5d14](https://github.com/TimSchoenle/actions/commit/41f5d14e6ff3bb5fb34672ec22f2131414f703be))

## [1.1.0](https://github.com/TimSchoenle/actions/compare/actions-security-codeql-v1.0.0...actions-security-codeql-v1.1.0) (2026-10-10)


### Features

* **Actions/Security-CodeQL:** add CodeQL action that excludes test sources ([#1820](https://github.com/TimSchoenle/actions/issues/1820)) ([2d8e788](https://github.com/TimSchoenle/actions/commit/2d8e788ac1bdba4f47d5e7686e7e8c4028b26627))


### Miscellaneous

* **deps:** update step-security/harden-runner action to v2.21.0 ([#1474](https://github.com/TimSchoenle/actions/issues/1474)) ([5f77c7a](https://github.com/TimSchoenle/actions/commit/5f77c7a65b4e99f62c9ecdeaa22766a35dc017c5))
* **deps:** update step-security/harden-runner action to v2.21.0 ([#1513](https://github.com/TimSchoenle/actions/issues/1513)) ([71715a0](https://github.com/TimSchoenle/actions/commit/71715a04001a9398d4f6baf46c8032c79d6836ff))
