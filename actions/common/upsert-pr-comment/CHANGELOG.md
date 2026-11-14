# Changelog

## [3.0.1](https://github.com/TimSchoenle/actions/compare/src-actions-common-upsert-pr-comment-v3.0.0...src-actions-common-upsert-pr-comment-v3.0.1) (2026-11-13)


### Bug Fixes

* stop the auto-rebase listing from timing out, and retry transient GitHub 5xx on reads ([#2310](https://github.com/TimSchoenle/actions/issues/2310)) ([be1dbca](https://github.com/TimSchoenle/actions/commit/be1dbcab18907c8eafd4243402a258ed8383fbe2))

## [3.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-common-upsert-pr-comment-v2.0.4...src-actions-common-upsert-pr-comment-v3.0.0) (2026-11-12)


### ⚠ BREAKING CHANGES

* **upsert-pr-comment:** a workflow whose token posts as a person, such as a personal access token, must set `author` to that login. Without it no earlier comment qualifies and every run posts a new comment.

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
* **upsert-pr-comment:** adopt only App-posted comments when author is empty ([#2198](https://github.com/TimSchoenle/actions/issues/2198)) ([e641153](https://github.com/TimSchoenle/actions/commit/e64115392f9e2f4227f72e486841217bdcb2acd6))

## [2.0.4](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v2.0.3...actions-common-upsert-pr-comment-v2.0.4) (2026-11-10)


### Code Refactoring

* **common:** move the common actions off the toolkit's HTTP stack ([#2058](https://github.com/TimSchoenle/actions/issues/2058)) ([812d078](https://github.com/TimSchoenle/actions/commit/812d07807a9c34351af3e31e39248b85b8eeb282))
* move the remaining actions off the toolkit's HTTP stack ([#2059](https://github.com/TimSchoenle/actions/issues/2059)) ([55e9a9a](https://github.com/TimSchoenle/actions/commit/55e9a9a8ef8a7ee13fb4080c2c3b584d1bb94fea))
* **ts-util:** add a dependency-free actions runtime and a proxy-aware HTTP client ([#2057](https://github.com/TimSchoenle/actions/issues/2057)) ([23115ff](https://github.com/TimSchoenle/actions/commit/23115ff1123f61b51591663a15a3bae3ac79d4cb))

## [2.0.3](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v2.0.2...actions-common-upsert-pr-comment-v2.0.3) (2026-11-09)


### Dependencies

* **deps:** update typescript-eslint monorepo to v8.72.1 ([#2021](https://github.com/TimSchoenle/actions/issues/2021)) ([ad426da](https://github.com/TimSchoenle/actions/commit/ad426da610d733784d0b1b40a4f616ccc804cf08))

## [2.0.2](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v2.0.1...actions-common-upsert-pr-comment-v2.0.2) (2026-11-09)


### Dependencies

* **deps:** update vitest monorepo to v5.1.0 ([#2022](https://github.com/TimSchoenle/actions/issues/2022)) ([398bfe5](https://github.com/TimSchoenle/actions/commit/398bfe5214f00683881663c77507141906b14cd2))

## [2.0.1](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v2.0.0...actions-common-upsert-pr-comment-v2.0.1) (2026-11-01)


### Dependencies

* **deps:** update dependency @types/node to v26.6.6 ([#1965](https://github.com/TimSchoenle/actions/issues/1965)) ([91142e4](https://github.com/TimSchoenle/actions/commit/91142e46ab7ae90184a53f659a536462361d21d3))

## [2.0.0](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v1.3.0...actions-common-upsert-pr-comment-v2.0.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **Actions:** run every JavaScript action on node24 ([#1948](https://github.com/TimSchoenle/actions/issues/1948))

### Features

* **Actions:** run every JavaScript action on node24 ([#1948](https://github.com/TimSchoenle/actions/issues/1948)) ([344220d](https://github.com/TimSchoenle/actions/commit/344220d124144d170034a5edc83b43ed3a030367))

## [1.3.0](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v1.2.5...actions-common-upsert-pr-comment-v1.3.0) (2026-10-19)


### Features

* **Actions/Upsert-PR-Comment:** add create_new to correct a comment without starting one ([#1897](https://github.com/TimSchoenle/actions/issues/1897)) ([45a32ac](https://github.com/TimSchoenle/actions/commit/45a32ac4f9b93188b14facc9652a2fad8456e959))

## [1.2.5](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v1.2.4...actions-common-upsert-pr-comment-v1.2.5) (2026-10-19)


### Dependencies

* **deps:** update vitest monorepo to v5.0.5 ([#1893](https://github.com/TimSchoenle/actions/issues/1893)) ([4203cad](https://github.com/TimSchoenle/actions/commit/4203cadcad81743fffb9b5577b792d4f7cc6755f))

## [1.2.4](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v1.2.3...actions-common-upsert-pr-comment-v1.2.4) (2026-10-17)


### Dependencies

* **deps:** update vitest monorepo to v5.0.4 ([#1875](https://github.com/TimSchoenle/actions/issues/1875)) ([f1fd087](https://github.com/TimSchoenle/actions/commit/f1fd087ba71526256ab6d2f29e92d61c751675c8))

## [1.2.3](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v1.2.2...actions-common-upsert-pr-comment-v1.2.3) (2026-10-15)


### Dependencies

* **deps:** update dependency @types/node to v26.6.5 ([#1853](https://github.com/TimSchoenle/actions/issues/1853)) ([57df86d](https://github.com/TimSchoenle/actions/commit/57df86d54887c72d94867f77d17f45cdb2a6f016))
* **deps:** update dependency bun to v1.4.3 ([#1858](https://github.com/TimSchoenle/actions/issues/1858)) ([be4a7c7](https://github.com/TimSchoenle/actions/commit/be4a7c7cf344bc87659a6dd7dfdbd17b0768d2e5))

## [1.2.2](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v1.2.1...actions-common-upsert-pr-comment-v1.2.2) (2026-10-09)


### Bug Fixes

* **actions:** refuse symlinks that carry a path out of the workspace ([#1786](https://github.com/TimSchoenle/actions/issues/1786)) ([936deb8](https://github.com/TimSchoenle/actions/commit/936deb8b64e240c2ec14ead000f5cf995c1b75e6))

## [1.2.1](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v1.2.0...actions-common-upsert-pr-comment-v1.2.1) (2026-10-06)


### Miscellaneous

* **deps:** update dependency @types/node to v26.6.4 ([#1777](https://github.com/TimSchoenle/actions/issues/1777)) ([481bf53](https://github.com/TimSchoenle/actions/commit/481bf536ec8ed826eeb5b5a80c457f8c815948fa))

## [1.2.0](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v1.1.3...actions-common-upsert-pr-comment-v1.2.0) (2026-10-04)


### Features

* **Action/Upsert-PrComment:** add body_lines with header, footer and skip ([#1760](https://github.com/TimSchoenle/actions/issues/1760)) ([40228ab](https://github.com/TimSchoenle/actions/commit/40228abf5c658de76ab539b7f9fc8dd8afb3ff5f))


### Miscellaneous

* **deps:** update vitest monorepo to v5.0.3 ([#1759](https://github.com/TimSchoenle/actions/issues/1759)) ([2747329](https://github.com/TimSchoenle/actions/commit/2747329bac8690cb7da29c31735874e4c83c7384))

## [1.1.3](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v1.1.2...actions-common-upsert-pr-comment-v1.1.3) (2026-10-02)


### Miscellaneous

* **deps:** update dependency @types/node to v26.6.1 ([#1723](https://github.com/TimSchoenle/actions/issues/1723)) ([7e2332e](https://github.com/TimSchoenle/actions/commit/7e2332ef582f74d957ca5ec3b9913e3dd6e11c2e))
* **deps:** update dependency @types/node to v26.6.3 ([#1728](https://github.com/TimSchoenle/actions/issues/1728)) ([7307232](https://github.com/TimSchoenle/actions/commit/7307232c67390db5ecbeb5b444b048afdc24fb89))
* **deps:** update dependency fast-check to v4.10.1 ([#1717](https://github.com/TimSchoenle/actions/issues/1717)) ([12b58b6](https://github.com/TimSchoenle/actions/commit/12b58b6a7917f3308da59b5bd59fa1b649ddcfd2))
* **deps:** update dependency fast-check to v4.10.2 ([#1730](https://github.com/TimSchoenle/actions/issues/1730)) ([5dce227](https://github.com/TimSchoenle/actions/commit/5dce227fbce775d186af5dfb89d3f79f86be6a2f))
* **deps:** update dependency typescript to v7 ([#1143](https://github.com/TimSchoenle/actions/issues/1143)) ([98f1d03](https://github.com/TimSchoenle/actions/commit/98f1d03512a2223e231fe66291bf77a74ec640f1))
* **deps:** update vitest monorepo to v5.0.2 ([#1721](https://github.com/TimSchoenle/actions/issues/1721)) ([c0fb63e](https://github.com/TimSchoenle/actions/commit/c0fb63e2355714dae78131c3773b9184ec3f1fba))


### Dependencies

* **deps:** lock file maintenance ([#1725](https://github.com/TimSchoenle/actions/issues/1725)) ([82a5380](https://github.com/TimSchoenle/actions/commit/82a53807b20ab62253d6192aa52964a8417462f6))

## [1.1.2](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v1.1.1...actions-common-upsert-pr-comment-v1.1.2) (2026-09-15)


### Bug Fixes

* **deps:** update dependency yaml to v2.9.1 ([#1684](https://github.com/TimSchoenle/actions/issues/1684)) ([f228af0](https://github.com/TimSchoenle/actions/commit/f228af08cc1a1eedaf5ab6a68925fcfbaeca7908))


### Miscellaneous

* **deps:** update dependency @fast-check/vitest to v0.5.0 ([#1681](https://github.com/TimSchoenle/actions/issues/1681)) ([d043758](https://github.com/TimSchoenle/actions/commit/d043758f87cfc78928358e9c06019af6e80615dd))
* **deps:** update dependency @types/node to v26.5.0 ([#1661](https://github.com/TimSchoenle/actions/issues/1661)) ([2923099](https://github.com/TimSchoenle/actions/commit/29230993e5ebf615ce70bde86cbdc4e1791b7adc))
* **deps:** update dependency fast-check to v4.10.0 ([#1682](https://github.com/TimSchoenle/actions/issues/1682)) ([aecb207](https://github.com/TimSchoenle/actions/commit/aecb207aa17ebd8035891d653e8735c7c5c44cd9))


### Dependencies

* **deps:** lock file maintenance ([#1680](https://github.com/TimSchoenle/actions/issues/1680)) ([a7d833d](https://github.com/TimSchoenle/actions/commit/a7d833dc40338a230a034935086cac940f34c7d9))

## [1.1.1](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v1.1.0...actions-common-upsert-pr-comment-v1.1.1) (2026-09-10)


### Miscellaneous

* **deps:** update dependency @types/bun to v1.4.1 ([#1627](https://github.com/TimSchoenle/actions/issues/1627)) ([cebfecd](https://github.com/TimSchoenle/actions/commit/cebfecdc7a512c038bc658ab20bcc2df605af30f))

## [1.1.0](https://github.com/TimSchoenle/actions/compare/actions-common-upsert-pr-comment-v1.0.0...actions-common-upsert-pr-comment-v1.1.0) (2026-09-07)


### Features

* **Action/Upsert-PrComment:** add new action ([#1620](https://github.com/TimSchoenle/actions/issues/1620)) ([9f1921a](https://github.com/TimSchoenle/actions/commit/9f1921a5628905bec449d714154a94bf22cf1107))


### Miscellaneous

* **deps:** update step-security/harden-runner action to v2.21.0 ([#1474](https://github.com/TimSchoenle/actions/issues/1474)) ([5f77c7a](https://github.com/TimSchoenle/actions/commit/5f77c7a65b4e99f62c9ecdeaa22766a35dc017c5))
* **deps:** update step-security/harden-runner action to v2.21.0 ([#1513](https://github.com/TimSchoenle/actions/issues/1513)) ([71715a0](https://github.com/TimSchoenle/actions/commit/71715a04001a9398d4f6baf46c8032c79d6836ff))
* **deps:** update vitest monorepo to v5 ([#1619](https://github.com/TimSchoenle/actions/issues/1619)) ([9e0ec8d](https://github.com/TimSchoenle/actions/commit/9e0ec8d28fd551f5f9d6f3cb95c2c476e32d1f2a))
