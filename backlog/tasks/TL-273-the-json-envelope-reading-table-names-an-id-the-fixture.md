---
id: TL-273
title: "The json-envelope READING table names an id the fixture never has"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: envelope-green
    bash: "node --test scripts/tests/json-envelope.test.mjs"
---

## Goal

The `READING` table in `scripts/tests/json-envelope.test.mjs` binds every
envelope kind to a command that exercises it. Its `quote` row reads
`["quote", "TL-1", "--json"]`, and its comment states the reason for the id:
"the fixture's own first task is quoted, because the id has to exist — a
missing task exits 1 and would exercise the refusal instead."

The fixture's own first task is `TASK-1`. `backlog()` calls
`init --no-example`, which takes the default prefix from the shipped
`config.yaml`, and that prefix is `TASK` — `TL` is THIS repository's prefix,
not the fixture's. So the row asks about a task the fixture never had, the
answer comes back `quote: null`, exit 0, every declared key present, and the
guard is green while measuring the refusal path its comment says it avoids.

Done when the `quote` row exercises a task that exists in the fixture, and
when a wrong id cannot pass silently again.

## Context

**This is the failure mode the file itself warns about**, in its own header:
"A ZERO SAMPLE MUST NOT MAKE THIS GREEN." A row that names a non-existent id
is a zero sample for that kind — it satisfies every shape assertion without
reading anything.

**It is also the tool's own rule about foreign values.** `CLAUDE.md`:
"Do not assert another project's values. […] If a test needs a specific
value, it has to establish it with a fixture." `TL-1` is this repository's
value written into a fixture that does not share it. Any row naming a
literal id has the same defect waiting in it, so a fix that only edits the
string leaves the next one to be written the same way.

**The refusal rows are not affected and must stay.** `TASK-404` in the
`WRITING` table is deliberate — those rows carry `refuses: true` and are
about the refusal path. Only the rows whose comment claims to read a real
task are wrong.

Reproduce:

    node scripts/cli.mjs init --dir ./backlog --no-example
    node scripts/cli.mjs new --dir ./backlog --title "Task number 1"
    node scripts/cli.mjs quote TL-1   --dir ./backlog --json   # quote: null
    node scripts/cli.mjs quote TASK-1 --dir ./backlog --json   # a real quote

Found while TL-151 was adding a `resume` row to the same table.

## Steps

1. Make the fixture's id available to the table rather than typed into it —
   `backlog()` already knows the ids it created, so a row can ask for the
   first one instead of naming it.
2. Add a guard that a row naming a task id names one the fixture has, so the
   next row cannot repeat this.
3. Check every other row for the same defect before closing.

## Acceptance criteria

- [x] The `quote` row reads a task the fixture really created. [proof: envelope-green]
- [x] Positive control: pointing a row at a non-existent id FAILS the suite. [proof: envelope-green]
