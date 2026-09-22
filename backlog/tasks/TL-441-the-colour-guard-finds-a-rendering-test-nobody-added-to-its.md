---
id: TL-441
title: "The colour guard finds a rendering test nobody added to its list"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-22
updated: 2026-09-22
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/tests/suite-is-terminal-independent.test.mjs]
verification:
  - id: the-colour-guard
    bash: "node --test scripts/tests/suite-is-terminal-independent.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A test file that renders human-facing text and does not declare plain output
makes the colour guard fail, without anybody editing a list.

## Context

`scripts/tests/suite-is-terminal-independent.test.mjs` (TL-238) re-runs the
rendering tests with colour forced on, to prove the suite does not answer
differently in a terminal that paints. Which files it re-runs is a HAND-KEPT
constant, `RENDERING_TESTS`, carrying a comment that says a new rendering file
belongs there too — an unenforced convention.

It was not enforced. On 2026-09-22 `refusal-shape.test.mjs` and
`refusal-transcript.test.mjs` were found red under `FORCE_COLOR` on EVERY Node
version, including the one the developer runs. Both render human-facing text.
Both had never been on the list, so the guard never looked at them, and their
redness said nothing to anybody for as long as they had existed. They were
added by hand as part of TL-434 — which is the same unenforced convention,
applied once more.

**A list that must be kept by hand is a guard with a hole exactly the shape of
the next file somebody writes.**

## Pre-flight reading

1. `scripts/tests/suite-is-terminal-independent.test.mjs` — `RENDERING_TESTS`
   and the comment that asks for the discipline this task replaces.

## Steps

Two candidate designs; pick one and record in the commit body why the other was
rejected.

1. **Derive the set.** A test file that imports `../ui.mjs`, or that spawns
   `cli.mjs`, renders text — select those instead of listing them. The risk is
   a wider set than the guard can afford in time; measure it.
2. **Run the whole suite once with colour forced.** No list at all. The risk is
   duplicating the suite's runtime in CI; measure that too and consider making
   it one job of the matrix rather than a case inside the suite.

Whichever is chosen, the guard must keep its existing positive control.

## Acceptance criteria

- [ ] A rendering test file that does not declare plain output fails the guard without anyone editing a list. [proof: the-colour-guard]
- [ ] The guard's existing positive control still fails as designed. [proof: the-colour-guard]
- [ ] The whole suite stays green. [proof: suite-green]
