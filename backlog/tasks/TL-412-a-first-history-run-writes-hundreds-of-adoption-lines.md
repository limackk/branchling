---
id: TL-412
title: "A first history run writes hundreds of adoption lines nobody asked for"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: bulk-adoption-is-asked-for
    bash: "node --test scripts/tests/history-adoption.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A command writes hundreds of permanent lines into versioned, append-only logs
only because somebody asked it to. After TL-387, the first `branchling history`
run in a tree whose snapshot is partial appends one `__adopted__` entry for
every task it cannot vouch for — measured at roughly 404 in this repository —
and the operator learns this after the fact.

## Context

TL-387 closed on 2026-09-21 and is right about the thing it fixed: a field edit
the log could not attest was being called "no changes to record", which made an
unrecorded edit look like no edit. It now records an `__adopted__` entry naming
the fields, signed with the run's actor and reason, deduplicated so the fact is
stated once per task rather than once per worktree.

The consequence is stated in TL-387's own closing report and is not a defect in
its thesis: the adoption is written for ANY unattested field carrying a value,
because nothing can distinguish a hand edit from a clean `git pull` — in both
cases the local snapshot simply does not know the previous value. In a tree that
has never reconciled, that is every task at once.

**Why this needs an answer rather than a note.** `backlog/history/` is versioned
and append-only; AGENTS.md says a bad row is permanent. Four hundred rows
written as a side effect of a command somebody ran for one file are four hundred
rows nobody can take back, in the one directory this project refuses to rewrite.
The dedupe bounds them to once ever, which makes the cost a single event rather
than a recurring one — and a single irreversible event is exactly the kind that
deserves to be asked about rather than discovered.

**What the tool already has to say it with.** `--quiet` exists, the command
already counts what it will do before it does it, and `check` and `done` both
have a vocabulary for refusing rather than asking. The snapshot itself is
gitignored and computed, so a tree that reconciles on purpose before its first
edit pays nothing.

## Steps

1. Measure the real number in a fresh clone, not from this task's text: how many
   adoptions a first `history` run would write, and how many of those tasks were
   actually edited by hand.
2. Decide what the command does when the adoption count is disproportionate to
   what was asked. The candidates: report the count and refuse without an
   explicit flag; write them only for the tasks the run names (`--file`), and
   leave a whole-directory reconcile to say so separately; or keep today's
   behaviour and state the count before writing. Record it with
   `branchling decide`.
3. Whatever is chosen, an adoption that IS written must still be the honest
   record TL-387 made it — this task must not reintroduce "no changes to
   record" for an unrecorded edit.

## Acceptance criteria

- [ ] A run that would write adoptions for tasks the caller did not name says so
      before writing, and the rule is proven by a test that fails against
      today's code. [proof: bulk-adoption-is-asked-for]
- [ ] An unrecorded field edit is still never reported as no change.
      [proof: suite-green]
