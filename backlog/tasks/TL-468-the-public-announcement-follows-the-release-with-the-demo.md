---
id: TL-468
title: "The public announcement follows the release with the demo and front door"
type: task
labels: []
board: main
epic: "Backlog — open source publication"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-15
updated: 2026-10-15
blocked_by: [TL-102, TL-453, TL-455] # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: announcement-ready
    manual: "The demo recording is linked from the README header, the README passes TL-453's front-door test, `npx branchling --help` works from the registry, and the announcement links the released version."
---

## Goal

branchling is announced publicly only after 0.1.0 is on npm, with the sixty-second demo and the short README front door in place, so the first wave of visitors meets the finished first impression rather than the working one.

## Context

On 2026-10-15 the owner split publication from announcement. TL-455 publishes a basic 0.1.0 to npm and GitHub, gated only by the name clearance (TL-179) and npm installation instructions in the README. The demo recording (TL-102) and the compact README front door (TL-453) used to block TL-455; they were moved here because they are what makes an announcement land, not what makes a package installable. Windows support (TL-463, TL-456) and the macOS rerun budget (TL-466) are not prerequisites of either; the release notes of 0.1.0 state Windows as unverified instead.

## Steps

1. Confirm 0.1.0 is installable from npm and the README rendered on npmjs.com and GitHub links the TL-102 recording.
2. Decide the announcement channels and write the announcement text, stating the supported platforms honestly.
3. Publish the announcement; posting is an external action that needs the owner's explicit authorization at the time.

## Acceptance criteria

- [ ] The public announcement points at a released, demonstrable and legible package. [proof: announcement-ready]
