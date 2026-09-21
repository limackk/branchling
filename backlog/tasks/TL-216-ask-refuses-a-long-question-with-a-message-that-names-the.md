---
id: TL-216
title: "ask refuses a long --question with a message that names the wrong cause"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m                      # 30m | 2h | 1d | 1w
confidence: high                   # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  # REWRITTEN BECAUSE THE OLD BLOCK PASSED BEFORE ANY WORK WAS DONE (TL-260).
  # `ask-green` ran two whole files that were already green: TL-167 had since
  # moved the diagnosis into `reasonRefusal()`, so the wrong-cause sentence this
  # task was filed for no longer existed and the contract measured nothing. What
  # is still missing is the cap being DOCUMENTED rather than only enforced, so
  # the first entry now names one case that failed against the tree as found,
  # and greps for that case's own result line — a renamed or deleted test makes
  # the entry fail rather than pass on a zero sample.
  - id: help-states-the-cap
    bash: "node --test --test-name-pattern 'the cap on .--question. and .--option. is documented' scripts/tests/ask.test.mjs | grep -F '✔ the cap on'"
  - id: ask-green
    bash: "node --test scripts/tests/ask.test.mjs scripts/tests/ask-options.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`branchling ask` refuses a `--question` longer than 500 characters with the
sentence "is empty or reserved", which is false about the question it just
printed back. The refusal has to name the cause it actually refused for, the way
`--option` already does.

## Context

Measured on 2026-09-03 while working TL-206, on the first attempt to ask that
task's open question:

    $ branchling ask TL-206 --actor agent:sub-b --question "May a --plan run …" …
    ✗ branchling ask: `--question May a --plan run hand out work from a LATER wave …`
      is empty or reserved
      `unknown` and `proven` are what the tool writes when nobody stated a reason.
      → branchling ask --help

The question was neither empty nor reserved — the whole text was echoed in the
refusal, so both halves of the sentence are contradicted by the line they are
printed on. The real cause is `REASON_MAX_LENGTH` (500) in
`scripts/task-fields.mjs`: `isValidReason` returns false for empty, for the two
sentinels, AND for anything over the cap, and `parseAskArgs` translates that one
boolean into a message that mentions only the first two.

**The neighbouring message is already right.** `resolveOptions` in the same file
refuses an option with "is empty, reserved or longer than 500 characters" — so
the defect is one message out of two, and the fix has a model to copy inside the
same module. A number in the text alone is not enough, though: an author whose
question is 700 characters long is told the limit but not how far over it they
are, and the shape of the answer (trim, or split the question) depends on that.

**Why it costs more than it looks.** `ask` is the move an unattended session has
for "this is not mine to decide" — the session is by definition not going to
reason about a wrong diagnosis, it will retry with a differently-worded question
of the same length and be refused again. A wrong cause in a refusal an agent
meets is a loop, not a nuisance.

**Neither `--question` nor `--option` says the cap up front.** `ask --help`
documents neither, so the first time anybody learns about 500 is when they are
refused. That belongs in the same change: the flag's own help line is where a
limit is cheapest to read.

## Pre-flight reading

1. `scripts/ask-task.mjs` — `parseAskArgs` (the wrong message) and
   `resolveOptions` (the right one, ~40 lines above it).
2. `scripts/task-fields.mjs` — `isValidReason` and `REASON_MAX_LENGTH`: one
   boolean, three causes.
3. The other five callers of `isValidReason` (`next-task.mjs`,
   `take-task.mjs`, `handoff-task.mjs`, `decide-task.mjs`,
   `history-record.mjs`) all print "`--reason …` is empty or reserved" and carry
   the SAME defect for `--reason`. Fix them together or state in Decisions why
   not — five copies of one sentence is why it was only corrected in one place.

## Steps

1. Make the cause reportable rather than inferred: either a function beside
   `isValidReason` that returns WHICH rule failed, or a shared message builder
   the six callers use. One sentence in six files is what let five of them go
   stale.
2. The refusal for an over-long value states the limit and the actual length.
3. Do not echo a 700-character value back in full inside the refusal — the
   current message prints the whole question before saying it is "empty", which
   is what makes the contradiction so loud. Truncate what is quoted.
4. Say the limit in `ask --help` beside `--question` and `--option`.

## Acceptance criteria

- [x] A `--question` over 500 characters is refused with a message that names
      the length as the cause and gives both the limit and the actual length.
      [proof: help-states-the-cap]
- [x] An empty or reserved `--question` still gets the message it gets today.
      [proof: ask-green]
- [x] `ask --help` states the cap beside `--question` AND beside `--option`,
      with the number read from `REASON_MAX_LENGTH` rather than typed.
      [proof: help-states-the-cap]
- [x] The same refusal for `--reason` in the other commands is either corrected
      or its being left alone is recorded in Decisions. [proof: suite-green]

## Decisions

**The wrong-cause sentence was already gone.** TL-167 moved the diagnosis into
`reasonRefusal(value, flag)` in `scripts/task-fields.mjs` and converted seven
call sites, `--question` among them. Measured on 2026-09-21 against this tree, a
587-character question is refused with "`--question` is 587 characters long, and
at most 500 are kept", the value truncated to 60 characters — steps 1, 2 and 3
of this task, done there. Only step 4, the cap in `ask --help`, was outstanding,
and that is what this change is.

**The other `--reason` call sites are not touched here.** The five commands this
task named print what `reasonRefusal` returns already; the remaining direct
`isValidReason` callers (`scripts/done-task.mjs`, `scripts/decide-task.mjs`) are
TL-254 and TL-255, in flight in their own worktrees. Editing them here would put
two tasks in one commit.
