:robot: I have created a release *beep* *boop*
---


<details><summary>src-actions-helm-apply-chart-updates: 2.0.5</summary>

## [2.0.5](https://github.com/TimSchoenle/actions/compare/src-actions-helm-apply-chart-updates-v2.0.4...src-actions-helm-apply-chart-updates-v2.0.5) (2026-11-12)


### Bug Fixes

* **apply-chart-updates:** neutralize every mention and closing reference GitHub acts on ([#2204](https://github.com/TimSchoenle/actions/issues/2204)) ([1296547](https://github.com/TimSchoenle/actions/commit/1296547e78bf907d2adb4b7799ece83970215616))
* **apply-chart-updates:** refuse a chart-path with whitespace ([#2231](https://github.com/TimSchoenle/actions/issues/2231)) ([d8837ba](https://github.com/TimSchoenle/actions/commit/d8837ba406a6dcb6d065bd1732988d0ac4cb7b45))
* **apply-chart-updates:** stop a spliced tag from corrupting values.yaml ([#2248](https://github.com/TimSchoenle/actions/issues/2248)) ([8569ab6](https://github.com/TimSchoenle/actions/commit/8569ab68bf99fff196b885f8a8207550ccfa15bc))
* **apply-chart-updates:** write nothing and keep the chart version when nothing moved ([#2251](https://github.com/TimSchoenle/actions/issues/2251)) ([c901ffb](https://github.com/TimSchoenle/actions/commit/c901ffb30539c5a2ffbb0001f42af794cb591ef4))
* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))
</details>

<details><summary>src-actions-helm-update-chart-version: 1.7.6</summary>

## [1.7.6](https://github.com/TimSchoenle/actions/compare/src-actions-helm-update-chart-version-v1.7.5...src-actions-helm-update-chart-version-v1.7.6) (2026-11-12)


### Bug Fixes

* **update-chart-version:** check the charts repository out without its history ([#2273](https://github.com/TimSchoenle/actions/issues/2273)) ([fa84010](https://github.com/TimSchoenle/actions/commit/fa840108386e25d8d8728429d8cef8ab585ff550))
* **update-chart-version:** refuse a chart path that could forge step outputs ([#2236](https://github.com/TimSchoenle/actions/issues/2236)) ([9900676](https://github.com/TimSchoenle/actions/commit/990067680041dfc227ba734a28bccac52cf35700))


### Dependencies

* **deps:** update timschoenle/actions/actions/common/create-pull-request to vactions-common-create-pull-request-v1.0.29 ([#2107](https://github.com/TimSchoenle/actions/issues/2107)) ([b5f90d0](https://github.com/TimSchoenle/actions/commit/b5f90d07641e0522c98b782ed61ccb2913490de1))
</details>

<details><summary>src-actions-common-read-yaml: 3.0.0</summary>

## [3.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-common-read-yaml-v2.0.4...src-actions-common-read-yaml-v3.0.0) (2026-11-12)


###   BREAKING CHANGES

* **read-yaml:** an absolute `file`, or one outside the workspace, now fails the step. Copy such a file into the workspace first.

### Bug Fixes

* **read-yaml:** refuse a file outside the workspace ([#2197](https://github.com/TimSchoenle/actions/issues/2197)) ([b5a208f](https://github.com/TimSchoenle/actions/commit/b5a208f6a54ec824826eb71f0b499cf866b2bc96))
* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))
</details>

<details><summary>src-actions-common-modify-yaml: 3.0.0</summary>

## [3.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-common-modify-yaml-v2.0.4...src-actions-common-modify-yaml-v3.0.0) (2026-11-12)


###   BREAKING CHANGES

* **modify-yaml:** write version-like values as strings and report what was written ([#2256](https://github.com/TimSchoenle/actions/issues/2256))
* **modify-yaml:** refuse a file outside the workspace ([#2221](https://github.com/TimSchoenle/actions/issues/2221))

### Bug Fixes

* **modify-yaml:** refuse a file outside the workspace ([#2221](https://github.com/TimSchoenle/actions/issues/2221)) ([ab03771](https://github.com/TimSchoenle/actions/commit/ab03771f996a26efc29eb978dcc8d8dc0a663baa))
* **modify-yaml:** stop a spliced value from corrupting the file ([#2247](https://github.com/TimSchoenle/actions/issues/2247)) ([e0ba9a9](https://github.com/TimSchoenle/actions/commit/e0ba9a912efd6a1326781549777087c806771d2a))
* **modify-yaml:** write version-like values as strings and report what was written ([#2256](https://github.com/TimSchoenle/actions/issues/2256)) ([ee390c6](https://github.com/TimSchoenle/actions/commit/ee390c69a8c300f31c56c3eda4272dfa1c1f9ed6))
* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))
</details>

<details><summary>src-actions-common-setup-app-git-identity: 2.0.5</summary>

## [2.0.5](https://github.com/TimSchoenle/actions/compare/src-actions-common-setup-app-git-identity-v2.0.4...src-actions-common-setup-app-git-identity-v2.0.5) (2026-11-12)


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
</details>

<details><summary>src-actions-common-get-app-git-identity: 2.0.5</summary>

## [2.0.5](https://github.com/TimSchoenle/actions/compare/src-actions-common-get-app-git-identity-v2.0.4...src-actions-common-get-app-git-identity-v2.0.5) (2026-11-12)


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
</details>

<details><summary>src-actions-bun-setup-cached: 4.0.0</summary>

## [4.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-bun-setup-cached-v3.1.0...src-actions-bun-setup-cached-v4.0.0) (2026-11-12)


###   BREAKING CHANGES

* **bun-setup-cached:** fail when the working directory has no bun.lock ([#2249](https://github.com/TimSchoenle/actions/issues/2249))

### Bug Fixes

* **bun-setup-cached:** fail when the working directory has no bun.lock ([#2249](https://github.com/TimSchoenle/actions/issues/2249)) ([9b7707b](https://github.com/TimSchoenle/actions/commit/9b7707b3ccb07452be891796e86a540ef38e6232))
* **bun-setup-cached:** keep setup-bun's executable cache out of none and read-only ([#2215](https://github.com/TimSchoenle/actions/issues/2215)) ([89fd12e](https://github.com/TimSchoenle/actions/commit/89fd12e487680f01e65b48baf51cdf135eca2923))
* **setup-cached:** only read the cache on merge_group under cache-mode auto ([#2269](https://github.com/TimSchoenle/actions/issues/2269)) ([4c27b0c](https://github.com/TimSchoenle/actions/commit/4c27b0c36cb516f3691cd0073d87fe5747d96d54))
</details>

<details><summary>src-actions-common-commit-changes: 3.1.0</summary>

## [3.1.0](https://github.com/TimSchoenle/actions/compare/src-actions-common-commit-changes-v3.0.4...src-actions-common-commit-changes-v3.1.0) (2026-11-12)


### Features

* **commit-changes:** add literal_paths for paths that file_pattern cannot name ([#2250](https://github.com/TimSchoenle/actions/issues/2250)) ([93b60ad](https://github.com/TimSchoenle/actions/commit/93b60adcffec0bf176fb9613043d36a66e3ade4d))
* **commit-changes:** pin the commit to the checked-out head ([#2245](https://github.com/TimSchoenle/actions/issues/2245)) ([fd0649a](https://github.com/TimSchoenle/actions/commit/fd0649a7041b80ccdb981991ca185a786301d7d8))


### Bug Fixes

* **commit-changes:** refuse symbolic links instead of committing their targets ([#2216](https://github.com/TimSchoenle/actions/issues/2216)) ([d73995d](https://github.com/TimSchoenle/actions/commit/d73995d68247db8df8977fe7ae121b1860acbb46))
* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))
</details>

<details><summary>src-actions-helper-verify-commit-authors: 4.0.0</summary>

## [4.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-helper-verify-commit-authors-v3.0.4...src-actions-helper-verify-commit-authors-v4.0.0) (2026-11-12)


###   BREAKING CHANGES

* **verify-commit-authors:** reject fork pull requests and publish head_sha ([#2243](https://github.com/TimSchoenle/actions/issues/2243))

### Features

* **verify-commit-authors:** reject fork pull requests and publish head_sha ([#2243](https://github.com/TimSchoenle/actions/issues/2243)) ([d0fd536](https://github.com/TimSchoenle/actions/commit/d0fd53641c8a5651894068c3aace27bad97c0e66))


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
</details>

<details><summary>src-actions-common-create-pull-request: 1.0.30</summary>

## [1.0.30](https://github.com/TimSchoenle/actions/compare/src-actions-common-create-pull-request-v1.0.29...src-actions-common-create-pull-request-v1.0.30) (2026-11-12)


### Bug Fixes

* **create-pull-request:** report only this repository's pull request ([#2226](https://github.com/TimSchoenle/actions/issues/2226)) ([c4d8d15](https://github.com/TimSchoenle/actions/commit/c4d8d1573fbecefd5ba520718c6c6d1067618e5f))
* **create-pull-request:** skip the branch comparison after a commit ([#2239](https://github.com/TimSchoenle/actions/issues/2239)) ([6d2b80b](https://github.com/TimSchoenle/actions/commit/6d2b80b378a589a663f9b6832f954aa3e3618f22))
</details>

<details><summary>src-actions-common-upsert-pr-comment: 3.0.0</summary>

## [3.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-common-upsert-pr-comment-v2.0.4...src-actions-common-upsert-pr-comment-v3.0.0) (2026-11-12)


###   BREAKING CHANGES

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
</details>

<details><summary>src-actions-common-close-pull-request: 2.0.5</summary>

## [2.0.5](https://github.com/TimSchoenle/actions/compare/src-actions-common-close-pull-request-v2.0.4...src-actions-common-close-pull-request-v2.0.5) (2026-11-12)


### Bug Fixes

* **close-pull-request:** leave an already closed pull request alone ([#2210](https://github.com/TimSchoenle/actions/issues/2210)) ([4999585](https://github.com/TimSchoenle/actions/commit/499958516ebf1e92194162a346178e3335c31f66))
* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))
</details>

<details><summary>src-actions-common-delete-branch: 2.0.5</summary>

## [2.0.5](https://github.com/TimSchoenle/actions/compare/src-actions-common-delete-branch-v2.0.4...src-actions-common-delete-branch-v2.0.5) (2026-11-12)


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
</details>

<details><summary>src-actions-common-create-branch: 2.0.5</summary>

## [2.0.5](https://github.com/TimSchoenle/actions/compare/src-actions-common-create-branch-v2.0.4...src-actions-common-create-branch-v2.0.5) (2026-11-12)


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
</details>

<details><summary>src-actions-helper-resolve-base-branch: 2.0.5</summary>

## [2.0.5](https://github.com/TimSchoenle/actions/compare/src-actions-helper-resolve-base-branch-v2.0.4...src-actions-helper-resolve-base-branch-v2.0.5) (2026-11-12)


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
</details>

<details><summary>src-actions-java-gradle-auto-spotless: 2.0.4</summary>

## [2.0.4](https://github.com/TimSchoenle/actions/compare/src-actions-java-gradle-auto-spotless-v2.0.3...src-actions-java-gradle-auto-spotless-v2.0.4) (2026-11-12)


### Dependencies

* **deps:** update timschoenle/actions/actions/common/create-patch to vactions-common-create-patch-v2.0.2 ([#2106](https://github.com/TimSchoenle/actions/issues/2106)) ([1fd40ed](https://github.com/TimSchoenle/actions/commit/1fd40edda8726613286feac19ed9562e03522f6c))
</details>

<details><summary>src-actions-maintenance-auto-approve-pr: 3.0.5</summary>

## [3.0.5](https://github.com/TimSchoenle/actions/compare/src-actions-maintenance-auto-approve-pr-v3.0.4...src-actions-maintenance-auto-approve-pr-v3.0.5) (2026-11-12)


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
</details>

<details><summary>src-actions-helper-verify-branch-name: 3.0.0</summary>

## [3.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-helper-verify-branch-name-v2.0.4...src-actions-helper-verify-branch-name-v3.0.0) (2026-11-12)


###   BREAKING CHANGES

* **helper-verify-branch-name:** an empty `branch_pattern` now fails the step. Pass `'.*'` to keep accepting every branch name.

### Bug Fixes

* **helper-verify-branch-name:** fail on an empty branch_pattern ([#2202](https://github.com/TimSchoenle/actions/issues/2202)) ([10f3540](https://github.com/TimSchoenle/actions/commit/10f3540f0709c18d0de936924ac31bad968b3d7d))
* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))
</details>

<details><summary>src-actions-rust-auto-format: 2.0.4</summary>

## [2.0.4](https://github.com/TimSchoenle/actions/compare/src-actions-rust-auto-format-v2.0.3...src-actions-rust-auto-format-v2.0.4) (2026-11-12)


### Bug Fixes

* save the Rust cache from the default branch only, and skip it in rust auto-format ([#2238](https://github.com/TimSchoenle/actions/issues/2238)) ([ab9a54e](https://github.com/TimSchoenle/actions/commit/ab9a54ea7c6804c7663de48ade7f8e12cacf88ad))


### Dependencies

* **deps:** update timschoenle/actions/actions/common/create-patch to vactions-common-create-patch-v2.0.2 ([#2106](https://github.com/TimSchoenle/actions/issues/2106)) ([1fd40ed](https://github.com/TimSchoenle/actions/commit/1fd40edda8726613286feac19ed9562e03522f6c))
</details>

<details><summary>src-actions-rust-cargo-check: 2.0.0</summary>

## [2.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-rust-cargo-check-v1.1.8...src-actions-rust-cargo-check-v2.0.0) (2026-11-12)


###   BREAKING CHANGES

* **rust-cargo-check:** check out the event's commit, not the head branch by name ([#2219](https://github.com/TimSchoenle/actions/issues/2219))

### Bug Fixes

* **rust-cargo-check:** check out the event's commit, not the head branch by name ([#2219](https://github.com/TimSchoenle/actions/issues/2219)) ([17fc040](https://github.com/TimSchoenle/actions/commit/17fc0408ec21a8d0e555c52a906d6ccf694a8dff))
* save the Rust cache from the default branch only, and skip it in rust auto-format ([#2238](https://github.com/TimSchoenle/actions/issues/2238)) ([ab9a54e](https://github.com/TimSchoenle/actions/commit/ab9a54ea7c6804c7663de48ade7f8e12cacf88ad))
</details>

<details><summary>src-actions-rust-clippy: 2.0.0</summary>

## [2.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-rust-clippy-v1.1.14...src-actions-rust-clippy-v2.0.0) (2026-11-12)


###   BREAKING CHANGES

* **rust-clippy:** check out the event's commit, not the head branch by name ([#2241](https://github.com/TimSchoenle/actions/issues/2241))

### Bug Fixes

* **rust-clippy:** check out the event's commit, not the head branch by name ([#2241](https://github.com/TimSchoenle/actions/issues/2241)) ([8d52c40](https://github.com/TimSchoenle/actions/commit/8d52c40796b5a86002e65a07b6bb1971adb66c81))
* save the Rust cache from the default branch only, and skip it in rust auto-format ([#2238](https://github.com/TimSchoenle/actions/issues/2238)) ([ab9a54e](https://github.com/TimSchoenle/actions/commit/ab9a54ea7c6804c7663de48ade7f8e12cacf88ad))
</details>

<details><summary>src-actions-rust-coverage-codecov: 2.1.0</summary>

## [2.1.0](https://github.com/TimSchoenle/actions/compare/src-actions-rust-coverage-codecov-v2.0.9...src-actions-rust-coverage-codecov-v2.1.0) (2026-11-12)


### Features

* **rust-coverage-codecov:** add a cache input that defaults off when the job holds a credential ([#2228](https://github.com/TimSchoenle/actions/issues/2228)) ([ccc7465](https://github.com/TimSchoenle/actions/commit/ccc746597090c1b3a6a5c0dbe43732e27d0bd44c))


### Bug Fixes

* pin the Codecov CLI version in both coverage-codecov actions ([#2274](https://github.com/TimSchoenle/actions/issues/2274)) ([0637537](https://github.com/TimSchoenle/actions/commit/0637537fe823542ef0bd4382ef186567ccea0f95))


### Dependencies

* **deps:** update taiki-e/install-action action to v2.90.3 ([#2104](https://github.com/TimSchoenle/actions/issues/2104)) ([1d7c882](https://github.com/TimSchoenle/actions/commit/1d7c882c2bd6e4530c0326767d1968848f39f92e))
</details>

<details><summary>src-actions-rust-test: 2.0.0</summary>

## [2.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-rust-test-v1.1.5...src-actions-rust-test-v2.0.0) (2026-11-12)


###   BREAKING CHANGES

* **rust-test:** check out the event's commit, not the head branch by name ([#2220](https://github.com/TimSchoenle/actions/issues/2220))

### Bug Fixes

* **rust-test:** check out the event's commit, not the head branch by name ([#2220](https://github.com/TimSchoenle/actions/issues/2220)) ([36360ca](https://github.com/TimSchoenle/actions/commit/36360ca5e6b444c281765ae7ce7968de2aa76b01))
* save the Rust cache from the default branch only, and skip it in rust auto-format ([#2238](https://github.com/TimSchoenle/actions/issues/2238)) ([ab9a54e](https://github.com/TimSchoenle/actions/commit/ab9a54ea7c6804c7663de48ade7f8e12cacf88ad))


### Dependencies

* **deps:** update taiki-e/install-action action to v2.90.3 ([#2104](https://github.com/TimSchoenle/actions/issues/2104)) ([1d7c882](https://github.com/TimSchoenle/actions/commit/1d7c882c2bd6e4530c0326767d1968848f39f92e))
</details>

<details><summary>src-actions-maintenance-ensure-actions-are-executed: 2.0.5</summary>

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
</details>

<details><summary>src-actions-common-render-template: 3.0.5</summary>

## [3.0.5](https://github.com/TimSchoenle/actions/compare/src-actions-common-render-template-v3.0.4...src-actions-common-render-template-v3.0.5) (2026-11-12)


### Bug Fixes

* **render-template:** refuse an output that is a symbolic link ([#2254](https://github.com/TimSchoenle/actions/issues/2254)) ([e5e338f](https://github.com/TimSchoenle/actions/commit/e5e338fe81a221f2877a269161875e68b929dc39))
* **render-template:** remove Handlebars' log helper ([#2217](https://github.com/TimSchoenle/actions/issues/2217)) ([b803399](https://github.com/TimSchoenle/actions/commit/b803399ed81dba38b74a710c8eb882232a457529))
* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))
</details>

<details><summary>src-actions-rust-config-contract: 2.0.5</summary>

## [2.0.5](https://github.com/TimSchoenle/actions/compare/src-actions-rust-config-contract-v2.0.4...src-actions-rust-config-contract-v2.0.5) (2026-11-12)


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
</details>

<details><summary>src-actions-common-readme-variables: 2.1.5</summary>

## [2.1.5](https://github.com/TimSchoenle/actions/compare/src-actions-common-readme-variables-v2.1.4...src-actions-common-readme-variables-v2.1.5) (2026-11-12)


### Bug Fixes

* **readme-variables:** scan headings, links and Cargo strings in linear time ([#2211](https://github.com/TimSchoenle/actions/issues/2211)) ([4513bf9](https://github.com/TimSchoenle/actions/commit/4513bf9a892c399f5fd726e1dbc1e4dc8f7976e3))
* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))
</details>

<details><summary>src-actions-common-upsert-issue: 3.0.0</summary>

## [3.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-common-upsert-issue-v2.0.4...src-actions-common-upsert-issue-v3.0.0) (2026-11-12)


###   BREAKING CHANGES

* **upsert-issue:** adopt only App-opened issues when author is empty ([#2222](https://github.com/TimSchoenle/actions/issues/2222))

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
* **upsert-issue:** adopt only App-opened issues when author is empty ([#2222](https://github.com/TimSchoenle/actions/issues/2222)) ([ce5ab41](https://github.com/TimSchoenle/actions/commit/ce5ab415ea59a8b377015c05c5b8b9f3bb8bca40))
* **upsert-issue:** filter the scan by creator and create only labels the issue lacks ([#2271](https://github.com/TimSchoenle/actions/issues/2271)) ([0d4147d](https://github.com/TimSchoenle/actions/commit/0d4147d801a67a57f1c7adf65cfe67a377dec666))
</details>

<details><summary>src-actions-docker-image-check: 1.1.16</summary>

## [1.1.16](https://github.com/TimSchoenle/actions/compare/src-actions-docker-image-check-v1.1.15...src-actions-docker-image-check-v1.1.16) (2026-11-12)


### Bug Fixes

* **docker-image-check:** keep workspace Trivy files and the shared cache out of the scan ([#2227](https://github.com/TimSchoenle/actions/issues/2227)) ([08a4c69](https://github.com/TimSchoenle/actions/commit/08a4c697d7f93f56ecd106f53353b94b1ace8a3b))
* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))
</details>

<details><summary>src-actions-docker-image-check-summary: 2.0.6</summary>

## [2.0.6](https://github.com/TimSchoenle/actions/compare/src-actions-docker-image-check-summary-v2.0.5...src-actions-docker-image-check-summary-v2.0.6) (2026-11-12)


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
</details>

<details><summary>src-actions-security-codeql: 1.1.11</summary>

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
</details>

<details><summary>src-actions-java-gradle-coverage-codecov: 1.2.0</summary>

## [1.2.0](https://github.com/TimSchoenle/actions/compare/src-actions-java-gradle-coverage-codecov-v1.1.6...src-actions-java-gradle-coverage-codecov-v1.2.0) (2026-11-12)


### Features

* **java-gradle-coverage-codecov:** add a cache input that defaults off when the job holds a credential ([#2229](https://github.com/TimSchoenle/actions/issues/2229)) ([45ead4e](https://github.com/TimSchoenle/actions/commit/45ead4e78e9c5a6b0034441690a2478cbcd459d4))


### Bug Fixes

* pin the Codecov CLI version in both coverage-codecov actions ([#2274](https://github.com/TimSchoenle/actions/issues/2274)) ([0637537](https://github.com/TimSchoenle/actions/commit/0637537fe823542ef0bd4382ef186567ccea0f95))
</details>

<details><summary>src-actions-security-zizmor: 2.0.6</summary>

## [2.0.6](https://github.com/TimSchoenle/actions/compare/src-actions-security-zizmor-v2.0.5...src-actions-security-zizmor-v2.0.6) (2026-11-12)


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
</details>

<details><summary>src-actions-terrace-setup: 4.0.0</summary>

## [4.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-terrace-setup-v3.1.3...src-actions-terrace-setup-v4.0.0) (2026-11-12)


###   BREAKING CHANGES

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
</details>

<details><summary>src-actions-terrace-image: 1.1.4</summary>

## [1.1.4](https://github.com/TimSchoenle/actions/compare/src-actions-terrace-image-v1.1.3...src-actions-terrace-image-v1.1.4) (2026-11-12)


### Bug Fixes

* **terrace-image:** check the signer before attaching or signing anything ([#2205](https://github.com/TimSchoenle/actions/issues/2205)) ([353ae58](https://github.com/TimSchoenle/actions/commit/353ae581e510ce6e970ae53ba49d913303e77c30))
</details>

<details><summary>src-actions-common-create-patch: 2.0.3</summary>

## [2.0.3](https://github.com/TimSchoenle/actions/compare/src-actions-common-create-patch-v2.0.2...src-actions-common-create-patch-v2.0.3) (2026-11-12)


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
</details>

<details><summary>src-actions-common-commit-patch: 3.0.0</summary>

## [3.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-common-commit-patch-v2.0.1...src-actions-common-commit-patch-v3.0.0) (2026-11-12)


###   BREAKING CHANGES

* **commit-patch:** require branch and head with run_id, and validate the branch ([#2223](https://github.com/TimSchoenle/actions/issues/2223))

### Bug Fixes

* **commit-patch:** require branch and head with run_id, and validate the branch ([#2223](https://github.com/TimSchoenle/actions/issues/2223)) ([f7671a0](https://github.com/TimSchoenle/actions/commit/f7671a0030fc5bab4969aab4511f18669e34c7c7))
* **commit-patch:** skip a deleted branch as branch_moved instead of failing ([#2233](https://github.com/TimSchoenle/actions/issues/2233)) ([46ffb77](https://github.com/TimSchoenle/actions/commit/46ffb779b551528f2917ada422216bf4ec863392))
* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))
</details>

<details><summary>src-actions-maintenance-wipe-cache: 3.0.5</summary>

## [3.0.5](https://github.com/TimSchoenle/actions/compare/src-actions-maintenance-wipe-cache-v3.0.4...src-actions-maintenance-wipe-cache-v3.0.5) (2026-11-12)


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
</details>

<details><summary>src-actions-maintenance-auto-rebase: 3.0.5</summary>

## [3.0.5](https://github.com/TimSchoenle/actions/compare/src-actions-maintenance-auto-rebase-v3.0.4...src-actions-maintenance-auto-rebase-v3.0.5) (2026-11-12)


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
</details>

<details><summary>src-actions-maintenance-timed-auto-merge: 3.0.0</summary>

## [3.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-maintenance-timed-auto-merge-v2.0.5...src-actions-maintenance-timed-auto-merge-v3.0.0) (2026-11-12)


###   BREAKING CHANGES

* **timed-auto-merge:** measure the soak time from the newest commit ([#2244](https://github.com/TimSchoenle/actions/issues/2244))

### Bug Fixes

* **timed-auto-merge:** measure the soak time from the newest commit ([#2244](https://github.com/TimSchoenle/actions/issues/2244)) ([6da998c](https://github.com/TimSchoenle/actions/commit/6da998c0f46324df494cc2d8d1fac03f20feb4fc))
* **timed-auto-merge:** stop re-approving a pull request that is already queued ([#2272](https://github.com/TimSchoenle/actions/issues/2272)) ([f1ce5c5](https://github.com/TimSchoenle/actions/commit/f1ce5c5d6da21d9b5ea5a95024aec64d2e6793a4))
* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))
</details>

<details><summary>src-actions-maintenance-trigger-coderabbit-review: 2.0.2</summary>

## [2.0.2](https://github.com/TimSchoenle/actions/compare/src-actions-maintenance-trigger-coderabbit-review-v2.0.1...src-actions-maintenance-trigger-coderabbit-review-v2.0.2) (2026-11-12)


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
</details>

<details><summary>src-actions-common-find-patch: 1.1.4</summary>

## [1.1.4](https://github.com/TimSchoenle/actions/compare/src-actions-common-find-patch-v1.1.3...src-actions-common-find-patch-v1.1.4) (2026-11-12)


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
</details>

<details><summary>src-actions-common-generated-files-verdict: 1.2.4</summary>

## [1.2.4](https://github.com/TimSchoenle/actions/compare/src-actions-common-generated-files-verdict-v1.2.3...src-actions-common-generated-files-verdict-v1.2.4) (2026-11-12)


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


### Dependencies

* **deps:** update timschoenle/actions/actions/common/create-patch to vactions-common-create-patch-v2.0.2 ([#2106](https://github.com/TimSchoenle/actions/issues/2106)) ([1fd40ed](https://github.com/TimSchoenle/actions/commit/1fd40edda8726613286feac19ed9562e03522f6c))
</details>

<details><summary>src-actions-common-commit-generated-files: 1.3.0</summary>

## [1.3.0](https://github.com/TimSchoenle/actions/compare/src-actions-common-commit-generated-files-v1.2.4...src-actions-common-commit-generated-files-v1.3.0) (2026-11-12)


### Features

* **commit-generated-files:** skip excluded and non-plain branches ([#2224](https://github.com/TimSchoenle/actions/issues/2224)) ([136e4e8](https://github.com/TimSchoenle/actions/commit/136e4e81a11c161bdb20f3d3fd6daf8a5988d401))


### Bug Fixes

* **commit-generated-files:** read whether a fork allows edits only when there is a patch ([#2240](https://github.com/TimSchoenle/actions/issues/2240)) ([5d1ec2e](https://github.com/TimSchoenle/actions/commit/5d1ec2ea05b61d099ba7110a0e780be1ddec8779))
</details>

<details><summary>src-actions-common-render-readme: 1.1.2</summary>

## [1.1.2](https://github.com/TimSchoenle/actions/compare/src-actions-common-render-readme-v1.1.1...src-actions-common-render-readme-v1.1.2) (2026-11-12)


### Dependencies

* **deps:** update timschoenle/actions/actions/common/create-patch to vactions-common-create-patch-v2.0.2 ([#2106](https://github.com/TimSchoenle/actions/issues/2106)) ([1fd40ed](https://github.com/TimSchoenle/actions/commit/1fd40edda8726613286feac19ed9562e03522f6c))
</details>

<details><summary>src-actions-common-download-release-asset: 1.1.4</summary>

## [1.1.4](https://github.com/TimSchoenle/actions/compare/src-actions-common-download-release-asset-v1.1.3...src-actions-common-download-release-asset-v1.1.4) (2026-11-12)


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
</details>

<details><summary>src-actions-common-fetch-head: 2.0.2</summary>

## [2.0.2](https://github.com/TimSchoenle/actions/compare/src-actions-common-fetch-head-v2.0.1...src-actions-common-fetch-head-v2.0.2) (2026-11-12)


### Bug Fixes

* **fetch-head:** copy no git template and run no hook in the fetched repository ([#2203](https://github.com/TimSchoenle/actions/issues/2203)) ([60133b6](https://github.com/TimSchoenle/actions/commit/60133b60a315a78350999c887c1887030f6a70a8))
* **ts-util:** break the legacy ##[ prefix and escape bidi controls in quoteForLog ([#2260](https://github.com/TimSchoenle/actions/issues/2260)) ([b7f7085](https://github.com/TimSchoenle/actions/commit/b7f708587db2f119233f297139f7a651ed3b5be7))
* **ts-util:** infer a number only when it writes back as the same text ([#2255](https://github.com/TimSchoenle/actions/issues/2255)) ([1c28fcc](https://github.com/TimSchoenle/actions/commit/1c28fcca8a42d0cb4bd11f45b85a5feb78cfa273))
* **ts-util:** read a ] that opens a bracket expression as a literal ([#2252](https://github.com/TimSchoenle/actions/issues/2252)) ([b9cb578](https://github.com/TimSchoenle/actions/commit/b9cb5788344156dcaa6b102f53d576380ed0e1a5))
* **ts-util:** read a pull request's head repository and each commit's date ([#2242](https://github.com/TimSchoenle/actions/issues/2242)) ([81ab139](https://github.com/TimSchoenle/actions/commit/81ab139e33c78c8f27a5b60d522ab491caec768c))
* **ts-util:** refuse a workspace path that reaches a .git directory ([#2253](https://github.com/TimSchoenle/actions/issues/2253)) ([1b368bd](https://github.com/TimSchoenle/actions/commit/1b368bda3a76a8dc1c9a0d997a621607fb0a2850))
* **ts-util:** retry a missing branch head only for a branch just created ([#2259](https://github.com/TimSchoenle/actions/issues/2259)) ([ed83c5b](https://github.com/TimSchoenle/actions/commit/ed83c5bb9e4638bcb6fb224bb63585f8f07b0d7b))
* **ts-util:** stop reporting a permission 403 as a rate limit ([#2257](https://github.com/TimSchoenle/actions/issues/2257)) ([cec33de](https://github.com/TimSchoenle/actions/commit/cec33deca70a406f81806bcaffff5328d45cfc77))
* **ts-util:** verify a spliced YAML edit and fall back when it would change the file's meaning ([#2246](https://github.com/TimSchoenle/actions/issues/2246)) ([5795688](https://github.com/TimSchoenle/actions/commit/5795688af68ab83067c9c9d554cecd509a0ab930))
* **ts-util:** wait at least a minute when GitHub names no rate-limit wait ([#2258](https://github.com/TimSchoenle/actions/issues/2258)) ([48d2aed](https://github.com/TimSchoenle/actions/commit/48d2aed276678f9b512752adcdd62ef7b247d039))
</details>

<details><summary>src-actions-release-resolve-actions: 1.1.1</summary>

## [1.1.1](https://github.com/TimSchoenle/actions/compare/src-actions-release-resolve-actions-v1.1.0...src-actions-release-resolve-actions-v1.1.1) (2026-11-12)


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
</details>

<details><summary>src-actions-release-build-actions: 1.1.1</summary>

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
</details>

<details><summary>src-actions-release-install-built-actions: 1.1.1</summary>

## [1.1.1](https://github.com/TimSchoenle/actions/compare/src-actions-release-install-built-actions-v1.1.0...src-actions-release-install-built-actions-v1.1.1) (2026-11-12)


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
</details>

<details><summary>src-actions-release-plan-release-please: 1.1.1</summary>

## [1.1.1](https://github.com/TimSchoenle/actions/compare/src-actions-release-plan-release-please-v1.1.0...src-actions-release-plan-release-please-v1.1.1) (2026-11-12)


### Bug Fixes

* **plan-release-please:** check source tags by name instead of paging every tag ([#2209](https://github.com/TimSchoenle/actions/issues/2209)) ([bb6accc](https://github.com/TimSchoenle/actions/commit/bb6accc3fa55a6e4b3f721048fc2b5caf3253617))
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
</details>

<details><summary>src-actions-release-publish-build-commit: 2.0.0</summary>

## [2.0.0](https://github.com/TimSchoenle/actions/compare/src-actions-release-publish-build-commit-v1.1.0...src-actions-release-publish-build-commit-v2.0.0) (2026-11-12)


###   BREAKING CHANGES

* **release-publish-build-commit:** refuse a bundle directly under actions/dist by default ([#2232](https://github.com/TimSchoenle/actions/issues/2232))

### Bug Fixes

* **publish-build-commit:** scale API requests with the release, not the history ([#2237](https://github.com/TimSchoenle/actions/issues/2237)) ([b845ad3](https://github.com/TimSchoenle/actions/commit/b845ad3b0a726a6e4eee5a9cf1ce7fbbe1081e51))
* **release-publish-build-commit:** refuse a bundle directly under actions/dist by default ([#2232](https://github.com/TimSchoenle/actions/issues/2232)) ([4f29b72](https://github.com/TimSchoenle/actions/commit/4f29b729b102f3d5710cfa4fbb20e417738d0937))
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
</details>

---
## Usage
See [README.md](README.md) for usage instructions.