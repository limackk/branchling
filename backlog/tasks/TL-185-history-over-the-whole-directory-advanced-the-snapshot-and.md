---
id: TL-185
title: "history over the whole directory advanced the snapshot and recorded nothing"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
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

**The cause was not one of the three candidates, and two of the three Steps
rested on a wrong premise.** Steps 2 and 3 were written as if the snapshot
advanced before the log was appended, and as if the `--attribute` report
suppressed the "recorded N" line. Neither is true. `reconcile()` already
appended every entry BEFORE `saveSnapshot()`, and a run reporting both counts
was reproduced against a copy of this repository's real backlog — the full log,
all 778 unattributed entries — where it recorded fifteen changes and printed
both blocks. The 778 count matching exactly is what proves the replication was
the same tree. The order guarantee was left as it was and given a comment plus a
test, rather than presented as a fix.

**The cause is two defects that only bite together.**

1. `reconcile()` used `only` to decide both which tasks may produce ENTRIES and
   which tasks get a REFERENCE POINT. The post-edit hook always passes `--file`,
   and `.snapshot.json` is gitignored, so every fresh worktree starts without
   one: the first hook run wrote a snapshot holding ONE task out of 194.
2. For a task absent from the snapshot, the branch asked a single question — is
   this a creation? — and if the task had history it wrote nothing and moved the
   snapshot on. The other 193 tasks were in that state, so every hand edit to
   any of them was absorbed in silence.

That explains the whole report, including the detail that looked incidental:
TL-183's `__created__` was the one history file in commit 78d2262 because TL-183
was created that day and had an EMPTY log, which is the only case the old branch
still wrote for.

**The reference point for a task the snapshot has never seen is the LOG.**
`lastChangeByField` already holds the last recorded value of every field it has
seen, and it is the same map `alreadyRecorded` trusts on the other branch, so
the two cannot disagree about what counts as recorded. A pulled task carries its
own log, agrees with it, and still records nothing — the case that branch exists
for is untouched.

**A field the log has never mentioned is absorbed, and named.** There is no
earlier value for it, so there is no honest `from`; writing `from: ""` would put
a fabricated change into an append-only log. Absorbing it silently is the defect
this task was opened for, so the run prints the tasks it adopted. The list names
a task even when an entry WAS written for it — the log vouching for one field
says nothing about the other sixteen, and naming only the tasks nothing was
recorded for would imply the rest were fully accounted for.

**Nine of the ten changes from 2026-09-03 turned out to be recorded after
all — in ANOTHER tree.** Found while merging: the MAIN checkout has a running
`serve`, and its reconcile wrote all nine `executor` entries at 09:26, as
`unknown`/`external`, into history files that are still uncommitted there. That
does not soften the defect — this worktree's own run absorbed them and wrote
nothing, which is what the fix addresses — but it changes what is left to do.
Once those nine files are committed, `history --attribute` has an `unknown`
entry to stand beside and the changes can be claimed.

**TL-183's `priority` P2 → P1 is recorded nowhere and stays that way.** No tree
caught it. The snapshot has absorbed it and the log has no `from` for it, so any
entry written now would be invented; `--attribute` has nothing to stand beside.

This tree is otherwise healthy: all 195 tasks are in the snapshot.

**Not done:** `scripts/regen-hook.mjs` spawns `history-record.mjs` without
`--dir` while it already knows the file's own root. That is TL-195, and it is a
different call site from the one fixed here.
