# Contributing to the BeyondTrust Workload Credentials Action

Thank you for your interest in contributing to our project!

Here is some information on how to get started and where to ask for help.

## Getting Started

The Workload Credentials action is a GitHub integration that retrieves secrets from BeyondTrust Workload Credentials within your GitHub Actions workflows.

## How can I Contribute?

### Reporting Bugs

Bugs should be submitted through [BeyondTrust Support](https://www.beyondtrust.com/support). Any bugs should be submitted against _Workload Credentials Support_. Our support team will ensure the escalation is raised to the proper team internally.

If the bug is a security vulnerability, instead please refer to the [responsible disclosure section of our security policy](https://www.beyondtrust.com/disclosure).

### Feature Requests

Feature requests should also be submitted through [BeyondTrust Support](https://www.beyondtrust.com/support), also against _Workload Credentials Support_. Submitting through our support organization will ensure the request gets sent to the proper Product Management team for consideration.

### Submitting Changes

Run `npm run all` (format check, lint, tests, build) before opening a pull request, and **commit the rebuilt `dist/` directory together with your source changes** — the `check-dist` check rebuilds the bundle and fails when the committed `dist/` does not match.

### Maintainers: bot pull requests

Dependabot cannot rebuild the bundle, so when a Dependabot PR bumps a production dependency the `Check dist` check fails until a maintainer pushes the rebuild to the PR branch:

```bash
gh pr checkout <number>
npm ci --ignore-scripts && npm run all
git add dist/ && git commit -S -m "chore: rebuild dist/" && git push
```

Commits must be signed (`-S`) — the branch ruleset rejects unsigned pushes.
