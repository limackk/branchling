---
id: TL-171
title: "A manual vouch nobody counts is a guarantee only on paper"
type: task
labels: []
board: main
epic: "Agentic differentiators"
priority: P1
status: done
owner: agent:claude
role: ""
executor: ""
estimate: 4h
confidence: medium
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs:
  - docs/branchling-state-and-sync.md
verification:
  - id: suite
    bash: "node --test scripts/tests/audit.test.mjs"
  - id: vouches
    bash: "node scripts/tests/audit-vouches.test.mjs"
---

## Goal

`worktrail audit` reports who vouched for `manual:` entries and how many, so a
backlog can be asked whether its manual gates are still evidence or have decayed
into a checkbox agents tick for themselves.

Once this is done, `audit --json` carries a vouch finding, and a fleet that
closes every manual entry with `--confirm-manual` is visible as a number rather
than as a feeling.

## Context

Surfaced on 2026-09-02 out of TL-89, alongside TL-170 but distinct from it.
TL-170 is about a refusal that leaves no trace. This one is about the opposite
end: a vouch that DOES leave a trace, which nothing ever reads.

The mechanism is sound and deliberately so. `--confirm-manual` is documented as
being "for a run with no terminal to ask at", and closing writes a
`FIELD_VERIFIED` event per vouched entry, carrying the actor and the entry's own
text (`scripts/done-task.mjs:634`). The comment there states the reason: without
it a `manual:` entry would leave no trace of who stood behind it, which is the
only thing it has to offer instead of a command. So autonomy was never blocked —
it was made attributable.

**What is missing is the reading side.** Nothing consumes those events.
`worktrail audit` is the command whose stated job is "the declarations, against
the traces they left", and its four findings are `closed with no trace`,
`reopened after closing`, `parked` and `no premise`. None of them looks at
vouches. So the tool records the one fact that distinguishes a real guarantee
from a ritual, and then never asks about it.

Why this matters more in a fleet than for a person at a keyboard: for an
unattended run `--confirm-manual` is the path of least resistance, and it
vouches for EVERY manual entry in the task at once. Nothing constrains when a
`manual:` entry was legitimate to write in the first place — 47 of this
backlog's tasks carry one — and nothing reports the rate at which they are
self-vouched. A guarantee whose erosion cannot be measured is indistinguishable
from one that has already eroded.

TL-89 is the worked example, and it cuts both ways. Its manual entry demands
that the markdown "was pasted into a real pull-request comment and renders
correctly there — the table has its columns … nothing shows as raw markup". But
its own suite already asserts `the markdown stays narrow — no HTML block, one
table shape, escaped pipes`. The shape IS machine-checked; the irreducible
remainder is only "in a real PR". The entry is therefore broader than the part
that genuinely resists automation — which is exactly the drafting failure this
task wants to make visible, not a fault of TL-89's author in particular.

## Decisions to make, not to assume

1. **A finding, or a table, or both.** `audit` distinguishes findings from the
   per-actor table. A self-vouch is not obviously a defect in one task; it is a
   pattern across many. The per-actor table already carries `min_report_n` and
   reports `not enough` rather than a rate on a small bucket — the same
   discipline applies here and should not be reinvented.
2. **What counts as self-vouching.** Actor namespace (`agent:` versus `user:`)
   is the cheap signal and is probably right, given `--confirm-manual` records
   the running actor. Decide whether the flag itself should be recorded
   distinctly from an interactive `confirm`, since today both produce the same
   event and the difference is precisely the thing worth counting.
3. **This reports, it does not gate.** `audit` is explicitly "a report, not a
   gate", and its help carries a standing warning that it is for backlog
   hygiene, not for judging people. Do not turn a vouch count into a refusal in
   `done`, and do not let the per-actor view read as an accusation.
4. **Out of scope: constraining WHEN `manual:` may be written.** A guard that
   judges whether an entry deserved to be manual is a different task and a much
   larger claim. Measure first.

## Acceptance criteria

- [x] `audit` reports vouched `manual:` entries with the actor that stood behind
      each one. [proof: vouches]
- [x] `audit --json` carries the same finding for a program. [proof: vouches]
- [x] A backlog with no vouches reports that, rather than going quiet — an empty
      section and a missing one must not look alike. [proof: vouches]
- [x] Every finding that existed before this task, and the rework table, are
      unchanged. [proof: suite]
