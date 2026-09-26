# Support policy

branchling is maintained as an open source, single-maintainer project. Help is
provided on a best-effort basis; opening an issue or pull request does not
create a guaranteed response or resolution time.

## Before opening an issue

Check the command's `--help` output and the [README](README.md). For unexpected
behaviour, use the
[bug report form](https://github.com/limackk/branchling/issues/new?template=bug_report.yml)
and include the command output, `branchling --version`, `node --version`, the
operating system and `branchling where` when it is available.

Use the
[feature request form](https://github.com/limackk/branchling/issues/new?template=feature_request.yml)
for a new capability. Describe the problem and the current workaround before
proposing an interface.

Do not report an undisclosed vulnerability in an issue. Follow the
[security policy](SECURITY.md) instead.

## What the project accepts

The CLI serves one person working in one clone, without a server operated by
the project. Local reading, editing, automation and loopback-only tools fit that
boundary. Accounts, hosted coordination, synchronisation between machines and
organisation-wide services do not. The complete rationale is in
[the licence and contribution model](docs/license-and-contributions.md#3-where-does-the-opencloud-line-run).

Issues and pull requests are evaluated for fit with that boundary, reproducible
evidence, tests, documentation and long-term maintenance cost. A technically
sound proposal can still be declined because it belongs outside the product or
because the maintenance commitment is not sustainable. Acceptance is not
guaranteed by prior discussion or by submitting an implementation.

## Contributing a fix

Read the [contribution guide](CONTRIBUTING.md) and the
[code of conduct](CODE_OF_CONDUCT.md). Pull requests need tests that can fail,
updated user-facing documentation where behaviour changes, a passing
`branchling check`, and commits signed off under the project's DCO.

Supported security lines are defined in [SECURITY.md](SECURITY.md). General
support for older releases, forks and unmerged branches is not promised.
