---
id: TL-185
title: "history over the whole directory advanced the snapshot and recorded nothing"
type: bug
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
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: whole-directory
    bash: "node --test scripts/tests/history-whole-directory.test.mjs"
---

## Goal

`branchling history` with no `--file` must record every change it absorbs, or
absorb none. On 2026-09-03 it absorbed ten and recorded zero: the snapshot
moved forward, the log gained nothing, and the command reported neither.

## Context

What happened, in order, in the worktree
`claude/autonomous-flow-tasks-35273f`:

1. Nine task files were edited by hand — `executor: ""` to `executor:
   "human"` — and TL-183's `priority` went from P2 to P1.
2. `branchling build` and `branchling check` were run. Both green.
3. `branchling history --actor agent:claude --source manual --reason "…"` was
   run over the whole directory. Its entire output was the `--attribute`
   block: "778 recorded change(s) carry no author". No "recorded N change(s)"
   line, no error.
4. `history/.snapshot.json` afterwards held `executor: human` for those nine
   tasks and `P1` for TL-183 — the snapshot had advanced.
5. No `.jsonl` file gained an entry. The commit that followed (78d2262)
   contains ten task files and one history file, and that one is TL-183's
   `__created__` from `new`.
6. The same command WITH `--file` on a single task, minutes later in the same
   tree, recorded correctly.

**It does not reproduce in an isolated tree.** A fresh backlog was created in a
scratch directory, a reference point taken, and one, two and three fields
changed at once, with and without an intervening `build`. Every combination
recorded correctly. So the cause is something this repository's tree has and
the probe did not — the most likely candidates, none of them confirmed:

- the 778 unattributed changes themselves: the `--attribute` branch may return
  before the recording branch runs when there is anything to attribute,
- two `branchling serve` processes running from the MAIN checkout of this
  clone (confirmed present, PIDs aside), reconciling on their own timer,
- a snapshot written by a command other than `history` — `new` now records a
  `__created__` entry (TL-182) and must have a reference point to do so.

**Why this is worse than a lost log line.** The log is the evidence layer the
audit, the PR comment and an actor's record all read. A change that was
absorbed without being recorded is not "missing history" — it is history that
now says nobody made the change, and the append-only rule means it can never
be corrected, only stood beside. It is also silent: the operator sees a
green command.

## Pre-flight reading

1. `scripts/history-record.mjs` — the command: the order of the `--attribute`
   branch, the reporting and the `reconcile()` call.
2. `scripts/history.mjs` — `reconcile()`, `unattributedChanges()` and where the
   snapshot is written relative to where entries are appended.
3. `docs/backlog-field-editing-history.md` — what the log promises.

## Steps

1. Reproduce it. The isolated probe is not enough; seed a fixture with
   unattributed entries AND a pending diff, which is the state this tree was
   in, and assert both are reported.
2. Whatever the cause, make the snapshot advance ONLY after the entries are
   appended — a crash between the two must lose the snapshot, never the log.
3. Report both counts in one run: what was recorded, and what carries no
   author. Today the second suppresses the first.
4. `scripts/tests/history-whole-directory.test.mjs` over that fixture.

## Decisions

Nothing decided. Note that a fix which only reorders the report would leave
the recording bug in place; the test must assert the LOG, not the output.
