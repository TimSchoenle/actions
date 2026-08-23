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
