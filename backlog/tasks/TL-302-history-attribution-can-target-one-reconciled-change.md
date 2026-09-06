---
id: TL-302
title: "History attribution can target one reconciled change"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-06
updated: 2026-09-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - scripts/history.mjs
verification:
  - id: targeted-attribution
    bash: "node --test scripts/tests/attribution.test.mjs scripts/tests/history-attribution-target.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

An author can attribute the reconciled change they made without claiming older
unowned events in the same task log. The command names the exact candidate or
refuses an ambiguous request before appending attribution.

## Context

On 2026-09-06, `history --file <TL-149> --attribute` was used to claim a new
`blocked_by` change. The command also attributed TL-149's `__created__` event
from 2026-09-02 to the current agent. The append-only log now honestly contains
both the old unknown event and the later mistaken claim; neither may be
rewritten.

File scope is insufficient when a log contains several unattributed events.
The fix needs an event-level selector or an interactive/non-interactive
disambiguation that works in automation. Do not infer "the latest" silently:
concurrent reconciliation can append more than one legitimate candidate.

## Pre-flight reading

1. `scripts/history.mjs` — locate candidate selection and attribution append.
2. `scripts/tests/attribution.test.mjs` — preserve the append-only claim model.
3. `backlog/history/TL-149.jsonl` — use the 2026-09-06 mistaken attribution as
   the concrete failure, never as a fixture modified by the test.

## Steps

1. Add a positive-control fixture with an old unowned creation and a new
   reconciled field change in one log.
2. Add an event-id selector to the attribution command, or require explicit
   disambiguation when more than one candidate exists.
3. Make an unscoped ambiguous attribution refuse without appending anything.
4. Preserve the convenient file-scoped path when exactly one candidate exists.
5. Document how a user reads candidate ids and attributes the intended event.

## Acceptance criteria

- [x] A user can attribute one named reconciled event without attributing an
      older unowned event in the same file. [proof: targeted-attribution]
- [x] More than one candidate without an event selector is refused before any
      history line is appended. [proof: targeted-attribution]
- [x] A file with exactly one candidate retains its current short workflow.
      [proof: targeted-attribution]
- [x] Existing history reconciliation and attribution tests remain green.
      [proof: suite-green]
