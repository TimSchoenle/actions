<!--
Generated from scripts/templates/SECURITY.md by `bun run generate-docs`. Edit the template, not this
file.

The version tables come from .release-please-manifest.json, so a component that releases appears
here in the same pull request that releases it.
-->

# Security Policy

## Supported Versions

Each component is versioned on its own. Only the versions listed below are supported; anything older
is not, including older versions of a component whose neighbours have since released.

<!-- SUPPORTED_VERSIONS_TABLE -->

## Reporting a Vulnerability

Do not open a public issue. Reports go through GitHub's private vulnerability reporting:

1. Open the **Security** tab of this repository.
2. Choose **Report a vulnerability** to open a private advisory.
3. Describe the vulnerability, the component it affects, and how to reproduce it.

The advisory stays private until a fix is released.

## Security Measures

CodeQL analyses every push to `main`, every pull request, and runs again every Monday. `jactionlint`
checks the workflow files and composite actions on the same triggers, with every check of `actionlint`
and every `zizmor` audit at its pedantic persona, and uploads its findings to code scanning. That
includes the audits that ask GitHub about the actions in use, such as archived, vulnerable or impostor
references, so they gate every pull request; the Monday run catches advisories published since the
last change. Renovate opens the dependency updates and auto-merges the non-major ones once they have
aged.

`main` is protected: a change reaches it through a pull request with an approval, signed commits, and
the required checks green.

## Supply Chain Security

A repository ruleset restricts who may create, move or delete a tag to the release bot, and the
release pipeline never moves one, so a tag cannot point at a different commit after a consumer has
pinned it. A second ruleset lets only the release bot advance the `releases` branch, by fast-forward.

`main` holds no build output. When a release pull request merges, the release workflow builds every
action bundle from the merge commit `M` twice, on separate runners, and stops unless both builds are
byte for byte identical. It signs SLSA build provenance for every bundle with GitHub artifact
attestations, then creates the build commit `B`: the tree of `M` plus the bundles, with nothing
removed or changed, and `M` as its second parent. The release tag goes on `B`, the source tag
`src-<tag>` on `M`, and each GitHub Release carries a `bundles.sha256` checksum file and the bundles.
The job that holds the release bot's key runs only actions pinned by commit, never code from the
repository. [docs/release-pipeline.md](docs/release-pipeline.md) has the details.

### Verifying a release

Every check below reads only public data. Set the tag you pin, for example:

```bash
tag=actions-common-read-yaml-v2.0.5
repo=TimSchoenle/actions

git clone --quiet --filter=blob:none --no-checkout "https://github.com/${repo}.git" verify && cd verify
build="$(git rev-parse "refs/tags/${tag}^{commit}")"
source="$(git rev-parse "refs/tags/src-${tag}^{commit}")"

# B is on the releases branch, M on main, and M is B's second parent.
git merge-base --is-ancestor "$build" origin/releases
git merge-base --is-ancestor "$source" origin/main
test "$(git rev-parse "${build}^2")" = "$source"

# B adds bundles under actions/**/dist/ and changes nothing else. Prints any other change and fails.
git diff --no-renames --name-status "$source" "$build" \
  | awk '$1 != "A" || $2 !~ /^actions\/.+\/dist\// { print; bad = 1 } END { exit bad }'

# Each bundle was built and signed by this repository's release workflow on main.
path=actions/common/read-yaml/dist/index.js
git show "${build}:${path}" > index.js
gh attestation verify index.js --repo "$repo" \
  --signer-workflow "${repo}/.github/workflows/release.yml" --source-ref refs/heads/main
```

A composite action with no bundle of its own has nothing to attest; the diff check still shows that
its files at `B` are exactly those at `M`, the commit its release notes describe. These checks apply
to releases published by the release workflow. Tags created before it point at a commit on `main` that
carries its bundles, and have no `src-` tag.

## Accepted Risks

### Commits signed by GitHub

[Verify Commit Authors](./actions/helper/verify-commit-authors),
[Maintenance Auto-approve-pr](./actions/maintenance/auto-approve-pr) and
[Maintenance Timed-auto-merge](./actions/maintenance/timed-auto-merge) accept a commit when every author
is one of the accepted accounts and its signature is valid. For a commit that a person signs with
their own key, the committer and the owner of the signing key must also be accepted accounts. GitHub
signs the commits that GitHub Apps, Renovate and the web interface create, and leaves the committer
of such a commit without a linked account. For those commits the actions check only the authors and
GitHub's signature.

GitHub signs a commit only when its author is the account that made it: the signed-in user in
the web interface, or the account that owns the token for a commit made through the API. The API
accepts a custom author only together with a signature the caller supplies, and such a commit has
to pass the committer and key owner checks. The risk is therefore anyone who can use the credential
of an accepted account. Write access to the repository is enough to run a workflow from a pushed
branch, and that workflow can use `GITHUB_TOKEN` and every repository secret, including App keys.
If `github-actions[bot]` or such an App is an accepted account, a person with write access can
create a commit that GitHub signs in its name, and the actions accept it. GitHub has no API that
shows who used a credential, so the actions cannot tell its owner from someone else using it.

This risk is accepted. Write access already allows more than this, pull requests from forks are
rejected by default, and rejecting commits that GitHub signs would stop Renovate and App pull
requests from being approved automatically. Give write access only to accounts you trust.

A fork can also make a commit that GitHub signs in the name of `github-actions[bot]`, without write
access, which is why forks are rejected. [Helper Verify-commit-authors](./actions/helper/verify-commit-authors)
applies the same checks and rejects forks the same way, unless `reject_forks` is `false`.
