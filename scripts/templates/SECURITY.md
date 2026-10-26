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

CodeQL analyses every push to `main`, every pull request, and runs again every Monday. `zizmor` lints
the workflow files under its pedantic persona and `actionlint` checks their syntax, both on the same
triggers. Renovate opens the dependency updates and auto-merges the non-major ones once they have
aged.

`main` is protected: a change reaches it through a pull request with an approval, signed commits, and
the required checks green.

## Supply Chain Security

Release tags are immutable and a repository ruleset restricts who may create them to the release bot,
so a tag cannot be moved to a different commit after a consumer has pinned it. Every action here is
published with its bundle committed, and CI rebuilds that bundle and compares it byte for byte
against what the branch carries.

## Accepted Risks

### Commits signed by GitHub

[Verify Commit Authors](./actions/helper/verify-commit-authors) and
[Maintenance Auto-approve-pr](./actions/maintenance/auto-approve-pr) accept a commit when every author
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
