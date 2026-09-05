---
id: TL-150
title: "An actor's record is computed from the log: first-pass closings, reopenings, handbacks"
type: task
labels: []
board: main
epic: ""
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:fleet
role: dev
estimate: 1d                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-05
blocked_by: ["TL-90"]
blocks: []
related_docs: ["docs/backlog-field-editing-history.md"]
verification:                      # HOW to check that the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

`worktrail actors` prints, per actor, what the history already knows and
nobody has added up: closings that passed the contract on the first attempt,
closings later reopened, tasks handed back as too large (TL-141), and, once
TL-30 exists, cost in tokens per closed task. Optionally, as a policy in
`config.yaml`, `next` withholds tasks above a priority from an actor below a
stated threshold.

This is what an event log with attributed actors is FOR, and no competitor
can produce it because none of them has actors or transitions. It is also the
number a team lead will ask for on the first day agents run unattended:
"which of these things can I trust with a P0".

## Context

**TL-90 first.** `audit` establishes the primitives — a `done` without a
trace, a reopening after `done`, a stale `in_progress`. This task aggregates
those findings by actor; it must not re-derive them. If `actors` and `audit`
disagree on what a reopening is, one of them is wrong and a reader cannot
tell which.

**Namespaces are the unit, not the nickname.** `local:anna` and `user:anna`
are two rows, deliberately: one is a declaration, the other an
authentication, and folding them would be the exact lie the namespace rule
exists to prevent. `legacy` entries (pre-TL-21, no namespace) are one row
labelled as such, never distributed to guesses.

**A rate needs a denominator that is stated.** "80% first-pass" over five
tasks and over five hundred are different claims. Print the count beside
every rate, and print nothing as a rate below a minimum sample declared in
`config.yaml` — say "n=3, too few" instead.

**Policy is opt-in and DISJOINT from selection order.** If `next` withholds
by actor record, that is a filter on eligibility, declared in the project
layer of configuration, and it must not reorder candidates — the ordering
policy is `next`'s and is tested. Default: no policy; `actors` is a report.

**No new state (law 2).** Everything is computed from `backlog/history/` at
read time. A cache, if ever needed, is deletable.

## Steps

1. Aggregate TL-90's per-task findings by actor with counts and
   denominators.
2. `actors` command with `--json` under the envelope; a `--since` window.
3. Minimum-sample rule from configuration; below it, no rate is printed.
4. Optional eligibility policy in `config.yaml`, refused if declared in the
   user layer.
5. Fixture with two actors of different records; positive control: with the
   policy on, the weaker actor is NOT handed the P0, and with it off, it is.

## Acceptance criteria

- [x] `actors` reports per actor: first-pass closings, reopenings, handbacks, each with its count. [proof: suite-green]
- [x] `local:` and `user:` of the same nickname are separate rows; `legacy` is its own row. [proof: suite-green]
- [x] Below the configured minimum sample no rate is printed, and the count is. [proof: suite-green]
- [x] The policy filters eligibility only and never reorders `next`'s candidates. [proof: suite-green]
- [x] Positive control: policy on withholds the P0 from the weaker actor; policy off hands it out. [proof: suite-green]
- [x] The policy key in the user layer is refused. [proof: guards-green]

## Where the spec hand stopped (2026-09-05, third pass)

**Both contract entries pass.** `node --test scripts/tests/*.test.mjs` is
1952 of 1952 and exits 0; `branchling check` exits 0. Nothing in this task
is red any more, and this pass wrote no new failing test, because there was
none left to write: every acceptance criterion above is already carried by a
case in `scripts/tests/actor-record.test.mjs`, which is 27 of 27.

**What this pass actually did was one line.** The suite was red in
`scripts/tests/json-envelope.test.mjs` alone, and for a reason that was
never about `actors` being wrong: that file's `READING` and `WRITING` tables
ARE the coverage registry, its positive control asserts they equal
`Object.keys(KINDS)` in both directions, and `actors` had been added to
`KINDS` with no row to exercise it. The dev hand could not add the row — it
lives under `scripts/tests/` — so it handed the task back naming the edit.
The row is now there, and the kind is exercised end to end on an empty
backlog and a populated one like every other.

**The registration is a one-off, not a rule for the repository.** TL-285
asks where the registry should live at all, and both of its answers stay
open; nothing here moved the tables or loosened the assertion that pins them
to `KINDS` in both directions. A kind added to
`KINDS` with no invocation still fails the suite, which is the property
TL-285 has to preserve whichever shape it picks.

**Where the fixture's answer is empty, and why that is the answer.** The
`actors` row runs against a backlog whose three tasks were created and never
closed, so no actor has a record and `rows` is legitimately `[]` on both
fixtures. That is the case worth pinning: `minReportN` and `policy` are
claims about the ANSWER rather than about its rows, and an empty report that
dropped them would read as a report with no threshold and no policy at all.
The zero sample is answered elsewhere on purpose — `actor-record.test.mjs`
carries a hand-written log with five actors of different records, and its
positive controls run against that.

**Two facts the hands recorded while here**, neither this task's to fix:
`actors:` in `backlog/config.yaml` is `[local:me, agent:claude]` and does
not include `agent:fleet`, which has written a dozen entries to this task's
log — a dead vocabulary that a per-actor report will make matter. And
`handoff` refuses the actor a charter names when the loop claimed the task
under a different one (TL-271 exports it now; the charter had not caught
up).
