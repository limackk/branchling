---
id: TL-172
title: "CLAUDE.md claims a test count that rots on every commit"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-09-02
updated: 2026-09-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-count
    bash: "grep -qE '^[0-9]+/[0-9]+, green' CLAUDE.md && { echo 'CLAUDE.md still states a count that nothing keeps current'; exit 1; }; echo 'no frozen tally in CLAUDE.md — OK'"
---

## Goal

The "Tests" section of `CLAUDE.md` stops asserting a number that nothing keeps
current.

## Context

`CLAUDE.md` states `693/693, green`. The suite is at 1440 as of 2026-09-02 —
the line has been wrong by a factor of two for some time, and nothing noticed
because no guard reads it.

It was found while closing TL-170, which added twelve tests. Updating the digits
would restore the claim for exactly one commit, which is why this is a task and
not a one-line fix: the question is whether that sentence should carry a tally at
all, or the command that produces one.

A frozen number is the failure mode this repository names elsewhere — still
specific, still confident, no longer true — and it sits in the file every session
reads before touching anything.

## Decisions to make, not to assume

1. **Drop the number, or keep it current.** Dropping it costs nothing and the
   command directly above it already prints the truth. Keeping it needs
   something that updates it, and a guard that rewrites a document on every
   commit is a larger machine than the sentence is worth.
2. **Whether anything else in `CLAUDE.md` has the same shape.** A tally is only
   the obvious case; a count of files or tasks quoted in prose rots the same
   way. Check before deciding, so the fix covers the class rather than the
   instance.

## Acceptance criteria

- [ ] `CLAUDE.md` no longer states a test tally that nothing keeps current.
      [proof: no-count]
