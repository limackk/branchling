---
id: TL-421
title: "import and seed refuse an over-long --reason as reserved, echoing the whole value"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m                      # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: high                    # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: cause-table-covers-both
    bash: "node --test scripts/tests/change-reason.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`branchling import-github --reason "<600 characters>"` and `branchling seed
--reason "<600 characters>"` are refused with "`--reason <the whole 600
characters>` is reserved", which is false about the value printed on the same
line. Both must print what `reasonRefusal(value, flag)` returns, like the seven
call sites TL-167 converted.

## Context

Found on 2026-09-21 while closing TL-216, which fixed the same defect for
`ask --question`. TL-167 put the diagnosis of an unusable reason in ONE place —
`reasonRefusal(value, flag)` in `scripts/task-fields.mjs`, re-exported from
`scripts/history.mjs` — which names WHICH of three rules a value breaks (empty,
one of the two reserved sentinels, longer than `REASON_MAX_LENGTH`) and quotes
at most the first 60 characters back. Seven call sites print what it returns.

Two more callers still expand the `isValidReason` boolean into a sentence of
their own about the sentinels alone:

- `scripts/import-github.mjs`, around line 137, in the `--reason` branch of the
  argument loop.
- `scripts/seed-backlog.mjs`, around line 135, the same code.

A reason of 600 characters breaks neither rule their message names, and the
whole value is echoed before the word "reserved", so the refusal contradicts
itself on the line it is printed on. A message naming a rule the value does not
break sends the reader looking in the wrong place.

`scripts/take-task.mjs` line 239 is NOT this defect: it uses `isValidReason`
to decide whether a reason is present at all, and its message is about a status
that requires one. Leave it.

TL-254 (`scripts/done-task.mjs`) and TL-255 (`decide --choose`) are the same
family and cover the other two direct callers; this task is only the two above.

## Pre-flight reading

1. `scripts/task-fields.mjs` — `reasonCause`, `reasonRefusal`,
   `REASON_ECHO_LENGTH`: the sentence to reuse, and why it exists.
2. `scripts/ask-task.mjs` line 189 — a converted call site, two lines long.
3. `scripts/tests/change-reason.test.mjs`, the `REASON_SITES` table — the guard
   that measures each converted site. It asserts the table has SEVEN entries,
   so adding these two means raising that number with them.

## Steps

1. Replace both hand-written messages with `reasonRefusal(reason, "--reason")`,
   importing it where `isValidReason` already comes from.
2. Add both commands to `REASON_SITES` in
   `scripts/tests/change-reason.test.mjs`, with their positive control, and
   raise the count the table asserts.

## Acceptance criteria

- [ ] A `--reason` longer than `REASON_MAX_LENGTH` given to `import-github` or
      to `seed` is refused with a message naming the LENGTH, quoting at most
      the first 60 characters. [proof: cause-table-covers-both]
- [ ] An empty or reserved `--reason` still names its own cause at both.
      [proof: cause-table-covers-both]
- [ ] `REASON_SITES` covers both, and the count it asserts was raised with
      them. [proof: cause-table-covers-both]
- [ ] The suite stays green. [proof: suite-green]
