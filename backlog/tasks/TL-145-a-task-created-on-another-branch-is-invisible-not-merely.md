---
id: TL-145
title: "A task created on another branch is invisible, not merely unlisted"
type: task
labels: []
board: main
epic: ""
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: ["TL-142"]
blocks: []
related_docs: ["docs/worktrail-state-and-sync.md"]
verification:                      # HOW to check that the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: one-scanner
    bash: "node scripts/cli.mjs check"
---

## Goal

`query` must report a task that exists only on an unmerged branch, naming that
branch, instead of behaving as though the task does not exist.

Today it does not, and `docs/worktrail-state-and-sync.md` §6.2 records that as
a deliberate boundary: *a task existing only on another branch still does not
appear in the list*. That was defensible while the reader and the writer were
the same person on one disk. It stops being defensible the moment a second
person reads the same backlog, because the failure mode reads as success — the
task is not reported as hidden, it is reported as absent.

TL-73 already settled the equivalent question for STATE: a task present here
but moved on another branch is shown with both statuses and the branch named
(`elsewhere: [feature/x: in_progress]`). This task applies the same rule to
EXISTENCE. The decision it implements was written in TL-142 — §6 of that
document now states the display rule, so this task writes code against a rule
that is already recorded, not one it has to invent.

## Context

**Do not add a second branch enumeration.** `scripts/branch-scan.mjs` already
generalises the scan from NUMBERS (`next-backlog-id.mjs`) to STATE, and
existence is the third question of the same shape. Two copies would diverge on
"which branches exist", which is precisely the difference that hands one task
to two sessions — the incident of 2026-09-01 recorded in `CLAUDE.md`.

Four constraints carry over from TL-73 and must not be quietly dropped:

1. **Local refs only, no `git fetch`.** The existing test substitutes its own
   `git` on PATH and asserts on the RECORDED invocations, because an assertion
   on the source would miss a fetch reached through an alias or a helper.
2. **The activity window** (`active_branch_days`) bounds the cost, but a
   branch CHECKED OUT in a worktree is always read.
3. **Your own branch is not a second opinion** — a tree must not report its own
   uncommitted state back to itself as divergence.
4. **`cross_branch_state` is the switch**; this must obey the same one rather
   than introducing a second.

Note what this is NOT: it is not the hosted mode. On a server the content
arrives ahead of any branch (TL-142, §6), so this display rule covers the
offline remainder and the whole of the local mode. It is worth doing on its own
merits and does not wait for a server that §8 says is not built yet.

## Steps

1. Extend `scripts/branch-scan.mjs` to collect task IDS present on other
   branches but absent from this tree, reusing the existing enumeration.
2. Report them from `query` under the rule §6 of the state-and-sync document
   now states, naming the branch.
3. Decide and implement what `stats` counts, consistent with how it already
   treats cross-branch state.
4. Add the positive control described below.

## Acceptance criteria

- [x] `query` reports a task that exists only on another unmerged branch, naming it. [proof: suite-green]
- [x] Such a task is NOT presented as an ordinary task of this tree. [proof: suite-green]
- [x] Positive control: the same fixture with no other branch reports it absent. [proof: suite-green]
- [x] Branch enumeration stays in `scripts/branch-scan.mjs` — no second enumeration. [proof: one-scanner]
- [x] No `git fetch`: the recorded-invocation assertion still holds. [proof: suite-green]
