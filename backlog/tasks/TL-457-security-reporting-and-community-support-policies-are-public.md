---
id: TL-457
title: "Security reporting and community support policies are public"
type: task
labels: []
board: main
epic: "Backlog — open source publication"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-26
updated: 2026-09-26
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: community-docs
    bash: "node --test scripts/tests/docs-links.test.mjs scripts/tests/publish-gate.test.mjs scripts/tests/community-health.test.mjs"
  - id: public-policies
    manual: "While signed out, use GitHub Security and Contributing entry points to find vulnerability reporting, supported versions, conduct and pull-request expectations without searching the repository tree."
---

## Goal

A user or contributor can find how to report a vulnerability, which versions receive fixes, what conduct is expected and what response to an issue or pull request the maintainer is prepared to sustain.

## Context

The repository already has MIT licensing, a DCO contribution model, CONTRIBUTING.md and issue templates. It does not yet have SECURITY.md, a code of conduct or a concise support policy. These files are commitments, not badges, so their scope must match a single-maintainer project and must not promise private channels, response times or supported release lines the owner cannot keep.

## Steps

1. Add SECURITY.md with supported versions and a vulnerability-reporting route that does not require publishing an exploit in a normal issue.
2. Adopt a concise code of conduct with an enforcement contact and scope the owner has explicitly accepted.
3. State issue and pull-request expectations, including the single-machine product boundary and that acceptance depends on fit and evidence rather than a guaranteed response time.
4. Link the policies from CONTRIBUTING.md and the GitHub community profile surfaces without duplicating their text.
5. Add documentation tests for every link and a manual signed-out check of GitHub security and community pages.

## Acceptance criteria

- [ ] The versioned security, conduct and support policies exist, are linked and are safe to publish. [proof: community-docs]
- [ ] The policies are discoverable through the public host where contributors look for them. [proof: public-policies]
