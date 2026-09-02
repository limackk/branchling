---
# ╭─────────────────────────────────────────────────────────────────────────╮
# │  THIS BACKLOG'S TASK TEMPLATE. `worktrail new --title "…"` copies it,    │
# │  assigns the number and fills in the dates — you do not copy it by      │
# │  hand. The vocabularies below (statuses, priorities, types) come from   │
# │  `config.yaml`; a value outside them FAILS the build rather than        │
# │  becoming a new one.                                                    │
# ╰─────────────────────────────────────────────────────────────────────────╯
id: TL-167
title: "A reason that is too long is refused as empty or reserved"
type: code
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m                      # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-02
updated: 2026-09-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: the-message-names-the-length
    bash: "node --test scripts/tests/change-reason.test.mjs"
  - id: one-diagnosis-not-six
    bash: "test $(grep -c 'is empty or reserved' scripts/*.mjs | grep -v ':0$' | wc -l) -le 1 && echo 'the refusal is written once — OK'"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs > /dev/null"
---

## Goal

A refusal names the reason it actually happened. A reason longer than
`REASON_MAX_LENGTH` is refused as too long, with the length it had and the
length allowed — not as "empty or reserved", which it is neither of.

## Context

`isValidReason()` in `scripts/task-fields.mjs` returns false for three different
things: an empty string, one of the two reserved sentinels, and a string longer
than 500 characters. Six call sites turn that one `false` into a message naming
only the first two:

    scripts/ask-task.mjs:84   scripts/decide-task.mjs:94
    scripts/handoff-task.mjs:108   scripts/history-record.mjs:82
    scripts/next-task.mjs:112   scripts/take-task.mjs:76

Measured, not guessed: a `worktrail handoff --reason "<600 characters>"` in a
real session was refused with "`--reason <the whole 600 characters>` is empty or
reserved", followed by two lines explaining that `unknown` and `proven` are the
tool's own words. The person who wrote that reason then has to work out that the
message is describing a rule their input does not break. That is worse than a
bare "invalid": a message naming the wrong cause sends the reader looking in the
wrong place, and the sentence they typed is echoed back in full while the one
number that would explain it — how long it was — is missing.

**The fix is not six edits.** Six copies of a diagnosis is how the diagnosis
came to be wrong in one place and stay wrong in all of them; this is the same
shape as TL-157's actor chain. `task-fields.mjs` already owns the rule, so it
should own the explanation: a function that returns WHY a reason is not usable,
or null when it is, and six call sites that print what it returns.

**Do not lengthen the echo.** A 600-character reason printed back in full is
already most of the refusal. Whatever the new message says, it should show the
beginning of the value and its length, not the whole of it.

## Pre-flight reading

1. `scripts/task-fields.mjs` — `isValidReason`, `REASON_SENTINELS`,
   `REASON_MAX_LENGTH`, and the comments explaining why each exists.
2. `scripts/take-task.mjs` around the refusal — the shape the other five copy.
3. `scripts/tests/change-reason.test.mjs` — where the rule is asserted today.

## Steps

1. Add the diagnosing function beside `isValidReason` and keep both: callers
   that only need a boolean should not have to read a string.
2. Point the six call sites at it.
3. A test per cause — empty, reserved, too long — asserting the message names
   that cause and no other.

## Acceptance criteria

- [ ] A reason over the limit is refused with a message naming its length and the limit, and not naming emptiness or the sentinels. [proof: the-message-names-the-length]
- [ ] An empty reason and a reserved one still say so, each in its own words. [proof: the-message-names-the-length]
- [ ] The explanation is written in one file. [proof: one-diagnosis-not-six]
- [ ] Nothing else in the suite changes. [proof: suite]

## Notes

- Found while handing off TL-158: the handoff reason was 600 characters and the
  refusal sent the author looking for a reserved word.
- `--question` in `ask-task.mjs` shares the validator and therefore the defect.
  It is the same fix, not a second one.
