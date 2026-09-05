---
id: TL-150
title: "An actor's record is computed from the log: first-pass closings, reopenings, handbacks"
type: task
labels: []
board: main
epic: ""
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending  # pending | in_progress | blocked | done | cancelled
owner: ""
role: spec
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

- [ ] `actors` reports per actor: first-pass closings, reopenings, handbacks, each with its count. [proof: suite-green]
- [ ] `local:` and `user:` of the same nickname are separate rows; `legacy` is its own row. [proof: suite-green]
- [ ] Below the configured minimum sample no rate is printed, and the count is. [proof: suite-green]
- [ ] The policy filters eligibility only and never reorders `next`'s candidates. [proof: suite-green]
- [ ] Positive control: policy on withholds the P0 from the weaker actor; policy off hands it out. [proof: suite-green]
- [ ] The policy key in the user layer is refused. [proof: guards-green]

## Where the spec hand stopped (2026-09-05)

The failing test for this task EXISTS and is not in this branch. The spec
hand wrote `scripts/tests/actor-record.test.mjs` and was cut off by its own
session limit before it could commit and hand on; the file was swept onto
`main` by a `git add -A`, found red there with no implementation, and taken
back out so the suite stays green. It is preserved on the branch
`tl-150-dev-leg`:

    git show tl-150-dev-leg:scripts/tests/actor-record.test.mjs

**What the dev hand found, and did not fix.** It refused to weaken somebody
else's proof and reproduced the collision instead: the case `the report
prints a row per actor and exits 0` asserts `audit` exits 0 over the
`withRecords` fixture, and that fixture writes three reopenings — they ARE
the weak actor's record — which `audit.mjs` counts into `findings`, so it
exits 1 by TL-90's contract. The rest of the file is implementable.

**So the next spec pass has one decision to make**, and it belongs in a task
of its own if it is not obvious: drop that assertion, or settle whether
rework stays an audit finding at all.

**Two facts the hands recorded while here**, neither this task's to fix:
`actors:` in `backlog/config.yaml` is `[local:me, agent:claude]` and does
not include `agent:fleet`, which has written a dozen entries to this task's
log — a dead vocabulary that a per-actor report will make matter. And
`handoff` refuses the actor a charter names when the loop claimed the task
under a different one (TL-271 exports it now; the charter had not caught
up).
