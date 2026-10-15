---
id: TL-455
title: "The first npm and GitHub release is reproducible and legible"
type: task
labels: []
board: main
epic: "Backlog — open source publication"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-26
updated: 2026-10-15
blocked_by: [TL-158, TL-179, TL-453, TL-454, TL-457, TL-461, TL-462, TL-463] # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: release-package
    bash: "node --test scripts/tests/release.test.mjs scripts/tests/publish-gate.test.mjs scripts/tests/demo-scenario.test.mjs"
  - id: release-guards
    bash: "node scripts/cli.mjs check"
  - id: public-release
    manual: "From a clean directory and while signed out of GitHub, install or run branchling 0.1.0 from npm, initialize a backlog, and confirm the GitHub tag, release notes and CI badge all name the same commit and version."
---

## Goal

Version 0.1.0 is published from the reviewed commit to npm and GitHub with provenance, release notes, a matching tag and installation instructions that work without cloning the repository.

## Context

The package currently passes npm pack --dry-run and its allowlist excludes this repository backlog, but npm view branchling still returns 404 and GitHub has no releases. Do not start publication until TL-102, TL-158 and TL-179 are closed: the demo, publicly inspected badge and name clearance are human gates. Publishing and pushing remain external actions requiring explicit owner authorization at execution time.

The npm organization `branchling` was registered by the owner on 2026-10-15. The package itself stays unscoped as `branchling`; the organization reserves the `@branchling` scope for any later package and is the account the release is published from, so its members, not one personal login, own the name.

## Steps

1. Write release notes that state the supported scope, installation command, first-success path, known limitations and upgrade expectations.
2. Run the complete publication gate against the exact commit that will be tagged.
3. Publish package and GitHub release from the same signed commit and version, with npm provenance where the registry workflow permits it.
4. Verify npx branchling --help and a fresh init from outside the repository using the registry package, not the local checkout.
5. Record the release process in a maintainable document or workflow so the next version repeats evidence rather than memory.
6. Confirm the public CI badge resolves to the released commit.

## Acceptance criteria

- [ ] The versioned tree and package satisfy the reproducible release, tarball and first-contact contracts. [proof: release-package]
- [ ] Every repository publication gate passes on the release commit. [proof: release-guards]
- [ ] The first public release is actually available and understandable to a stranger. [proof: public-release]
