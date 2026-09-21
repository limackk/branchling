---
id: TL-408
title: "A legacy history entry with no event id can be claimed twice"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - scripts/history.mjs
  - scripts/tests/history-attribution-concurrency.test.mjs
verification:                      # HOW to check the task is really done
  - id: idless-claim
    bash: "node --test scripts/tests/history-attribution-concurrency.test.mjs"
---

## Goal

A recorded change that carries no event id is claimed at most once, like every
other change.

## Context

TL-303 made a claim a single act: `attributeChanges()` in `scripts/history.mjs`
re-reads the unclaimed changes inside the repository-scoped mutex and refuses a
change that is no longer eligible. That check is keyed by the target entry's
`id`, and a target with no `id` is deliberately let through, because
`unattributedChanges()` cannot recognise it as claimed either — an
`__attributed__` entry links to the change it claims through `attributes`, and
an entry with no id has nothing to be linked to.

Every entry written by the current code has an id (`entry()` calls
`eventId(ts)`). The gap therefore concerns lines written before the field
existed: such a change can be claimed by two people, one after the other, with
no race involved at all, and both claims stand in an append-only file. TL-303
left this alone on purpose — closing it needs a way to name an id-less line
(a content hash of the line, or its ordinal in the file), which is a design
decision about the log's identity, not a concurrency fix.

## Pre-flight reading

1. `scripts/history.mjs` — `unattributedChanges()` and `attributeChanges()`;
   the `if (target.id)` branch is where the gap is stated.
2. `scripts/tests/history-attribution-concurrency.test.mjs` — the shape a
   claim-refusal test takes here.

## Steps

1. Decide how an id-less line is named, and write the reasoning down: a stable
   identity for a line nobody may rewrite is the whole of this task.
2. Make `unattributedChanges()` recognise a claim on such a line, and
   `attributeChanges()` refuse a second one.
3. Add a fixture with a log line that has no `id` and prove both halves.

## Acceptance criteria

- [ ] A change with no event id is offered once and claimed once; a second
      claim is refused without an append. [proof: idless-claim]
