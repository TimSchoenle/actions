# Security Policy

## Supported Versions

Any version not listed in the following tables is not supported.

<!-- SUPPORTED_VERSIONS_TABLE -->

## Reporting a Vulnerability

We accept vulnerability reports via GitHub's **Private Vulnerability Reporting** feature.

1. Go to the **Security** tab of this repository.
2. Click on **Report a vulnerability** to open a private advisory.
3. Provide details of the vulnerability.

This ensures that the report is handled securely and privately. Valid reports will be investigated and addressed as soon as possible.

## Security Measures

This repository employs several automated security measures to ensure the integrity and safety of the code:

- **CodeQL Analysis**: Automated vulnerability scanning is run on every push and pull request.
- **Dependency Updates**: Renovate is used to keep dependencies up-to-date and secure.
- **Action Linting**: `zizmor` is used to lint GitHub Actions workflows for security issues.
- **Branch Protection**: Main branch is protected and requires passing status checks before merging.

## Supply Chain Security

- **Protected Tags**: All Git tags are immutable and protected. They can only be created through our automated release CI process.
