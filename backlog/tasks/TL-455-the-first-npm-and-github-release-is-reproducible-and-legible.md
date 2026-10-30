---
id: TL-455
title: "The first npm and GitHub release is reproducible and legible"
type: task
labels: []
board: main
epic: "Backlog — open source publication"
priority: P1
status: awaiting_vouch  # pending | in_progress | blocked | done | cancelled
owner: ""
role: review  # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-26
updated: 2026-10-30
blocked_by: [TL-467]               # ids of tasks that MUST be closed before this one starts
blocks: [TL-468]                   # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: release-package
    bash: "node --test scripts/tests/release.test.mjs scripts/tests/publish-gate.test.mjs scripts/tests/demo-scenario.test.mjs scripts/tests/release-notes.test.mjs"
  - id: release-guards
    bash: "node scripts/cli.mjs check"
  - id: public-release
    manual: "From a clean directory and while signed out of GitHub, install or run the latest released branchling from npm, initialize a backlog, and confirm the GitHub tag, release notes and CI badge all name the same commit and version."
---

## Goal

Version 0.1.0 is published from the reviewed commit to npm and GitHub with provenance, release notes, a matching tag and installation instructions that work without cloning the repository.

## Context

The package currently passes npm pack --dry-run and its allowlist excludes this repository backlog, but npm view branchling still returns 404 and GitHub has no releases. On 2026-10-15 the owner separated publication from announcement: 0.1.0 is a basic release that claims the unscoped name on npm before somebody else does, and only two gates stand before it — the name clearance (TL-179), because a rename after publication costs far more than a search before it, and npm installation instructions in the README (TL-467), because the README is the package page. The demo (TL-102) and the compact README front door (TL-453) no longer block this task; they block the announcement (TL-468), which follows the release. Windows (TL-463, TL-456) and the macOS rerun budget (TL-466) are not prerequisites either: the release notes state Windows as unverified rather than supported. Publishing and pushing remain external actions requiring explicit owner authorization at execution time.

The npm organization `branchling` was registered by the owner on 2026-10-15. The package itself stays unscoped as `branchling`; the organization reserves the `@branchling` scope for any later package and is the account the release is published from, so its members, not one personal login, own the name.

**What happened since (recorded 2026-10-26).** The release went ahead
before the name clearance closed: `0.1.0` reached npm on 2026-10-22 and
`0.1.1` on 2026-10-26, each with a matching tag `v0.1.0` / `v0.1.1`, a
GitHub release and notes in `docs/releases/`. Both were published from a
maintainer's machine without npm provenance, which the notes say. TL-179
therefore no longer gates anything this task can still do — the name is
claimed, and a clearance now measures the risk of a rename rather than
preventing one. It was dropped from `blocked_by` for that reason and
stays open, at P1, on its own. Steps 1 and 3 are done; what remains is
the evidence that makes the NEXT release repeatable rather than
remembered: steps 2, 4, 5 and 6 below, judged against the latest
released version.

## Steps

1. Write release notes that state the supported scope (Linux and macOS; Windows unverified), installation command, first-success path, known limitations and upgrade expectations.
2. Run the complete publication gate against the exact commit that will be tagged.
3. Publish package and GitHub release from the same signed commit and version, with npm provenance where the registry workflow permits it.
4. Verify npx branchling --help and a fresh init from outside the repository using the registry package, not the local checkout.
5. Record the release process in a maintainable document or workflow so the next version repeats evidence rather than memory.
6. Confirm the public CI badge resolves to the released commit.

## Acceptance criteria

- [ ] The versioned tree and package satisfy the reproducible release, tarball and first-contact contracts. [proof: release-package]
- [ ] Every repository publication gate passes on the release commit. [proof: release-guards]
- [ ] The first public release is actually available and understandable to a stranger. [proof: public-release]
