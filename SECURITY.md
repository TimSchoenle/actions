# Security Policy

## Supported Versions

Any version not listed in the following tables is not supported.

### Actions

### Bun

| Component | Version | Supported |
| --- | --- | --- |
| [Bun Setup-cached](./actions/bun/setup-cached) | actions-bun-setup-cached-v1.1.1 | :white_check_mark: |

### Common

| Component | Version | Supported |
| --- | --- | --- |
| [Commit Changes](./actions/common/commit-changes) | actions-common-commit-changes-v1.1.1 | :white_check_mark: |
| [Common Modify YAML](./actions/common/modify-yaml) | actions-common-modify-yaml-v1.1.1 | :white_check_mark: |
| [Common Read YAML](./actions/common/read-yaml) | actions-common-read-yaml-v1.1.0 | :white_check_mark: |
| [Get App Git Identity](./actions/common/get-app-git-identity) | actions-common-get-app-git-identity-v1.1.0 | :white_check_mark: |
| [Setup App Git Identity](./actions/common/setup-app-git-identity) | actions-common-setup-app-git-identity-v1.1.0 | :white_check_mark: |

### Helm

| Component | Version | Supported |
| --- | --- | --- |
| [Update Helm Chart Version](./actions/helm/update-chart-version) | actions-helm-update-chart-version-v1.4.2 | :white_check_mark: |

### Helper

| Component | Version | Supported |
| --- | --- | --- |
| [Verify Commit Authors](./actions/helper/verify-commit-authors) | actions-helper-verify-commit-authors-v1.1.1 | :white_check_mark: |


### Workflows

### Common

| Component | Version | Supported |
| --- | --- | --- |
| [Common Test Workflow21345](./workflows/common/test2) | workflows-common-test2-v2.11.0 | :white_check_mark: |

### Maintenance

| Component | Version | Supported |
| --- | --- | --- |
| [Auto Format](./workflows/maintenance/auto-bun-prettier) | workflows-maintenance-auto-bun-prettier-v1.1.4 | :white_check_mark: |
| [Auto-Approve & Merge Timed PRs](./workflows/maintenance/timed-auto-pr-approve) | workflows-maintenance-timed-auto-pr-approve-v1.2.4 | :white_check_mark: |
| [Maintenance Auto-approve-renovate](./workflows/maintenance/auto-approve-renovate) | workflows-maintenance-auto-approve-renovate-v1.2.2 | :white_check_mark: |



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
