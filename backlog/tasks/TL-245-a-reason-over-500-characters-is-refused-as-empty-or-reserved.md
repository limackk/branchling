---
id: TL-245
title: "a reason over 500 characters is refused as \"empty or reserved\""
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: cancelled                  # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: length-named
    bash: "node --test scripts/tests/change-reason.test.mjs"
---

## Goal

A reason that is too LONG is refused for being too long, in a message that
names the limit and the length that was offered. `empty or reserved` is
reserved for a reason that really is empty or really is a sentinel.

## Context

Measured on 2026-09-04 while recording a decision on TL-213. The reason was 512
characters — twelve over `REASON_MAX_LENGTH` in `scripts/task-fields.mjs` — and
came back as:

    `--reason <the whole 512 characters>` is empty or reserved
      `unknown` and `proven` are what the tool writes when nobody stated a
      reason; typing one by hand would dress a machine's answer up as yours.

Neither half of that is true of the input, and the paragraph underneath argues
against a mistake nobody made. The author re-read their own sentence looking
for the word `unknown` in it before finding the limit in the source.

`isValidReason()` in `scripts/task-fields.mjs` collapses three different
verdicts — empty, sentinel, too long — into one boolean, so every caller that
formats a refusal can only name two of them and picks the wrong one. There are
seven such callers: `decide-task.mjs`, `handoff-task.mjs`, `take-task.mjs`,
`next-task.mjs`, `ask-task.mjs`, `done-task.mjs`, `import-github.mjs`,
`seed-backlog.mjs` and `serve-backlog.mjs` — which is why the fix belongs in
the shared function and not in the message of whichever command was called.

The obvious shape: a second export beside `isValidReason` that returns WHICH
rule the value broke (`"empty" | "reserved" | "too-long"`), with the callers
rendering it. `isValidReason` stays, because every one of those call sites also
just wants the boolean.

## Pre-flight reading

1. `scripts/task-fields.mjs` — `isValidReason`, `REASON_MAX_LENGTH`,
   `REASON_SENTINELS`, and the headers arguing why the sentinels exist.
2. `scripts/decide-task.mjs` around line 132 — one of the seven refusals, and
   the one that was measured.
3. `scripts/tests/change-reason.test.mjs` — where the rule about reasons is
   already tested, and where the new case belongs.

## Steps

1. Name the three verdicts in one place in `scripts/task-fields.mjs`.
2. Every caller that prints `is empty or reserved` prints the verdict it got,
   and the too-long one names `REASON_MAX_LENGTH` and the offered length.
3. A test per verdict, including a positive control that a valid reason of
   exactly `REASON_MAX_LENGTH` characters is still accepted — an off-by-one
   here would silently move the limit.

## Decisions

Nothing decided. Whether the limit itself is right is NOT this task: 500
characters is a deliberate choice with an argument beside it, and this task is
about the refusal being readable, not about moving the boundary.
