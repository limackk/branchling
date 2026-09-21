---
id: TL-422
title: "Six commands read --dir with their own parser, and none stops at --"
type: task
labels: []
board: main
epic: "CLI surface"
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - scripts/paths.mjs
  - scripts/done-task.mjs
  - scripts/take-task.mjs
verification:                      # HOW to check the task is really done
  - id: the-name                   # optional; a criterion below points at this id
    bash: "command to run"
---

## Goal

`--dir` is ONE flag with ONE reading, wherever it is typed. Today six commands
recognise it with a parser of their own, and each of those parsers differs from
`takeDirFlag()` in `scripts/paths.mjs` in two measurable ways: it reads `--dir`
from PAST a `--` separator, and it does not accept the `--dir=<path>` spelling
at all.

Once this is done, a `--dir` that follows `--` is a value in every command, the
`--dir=` spelling either works everywhere or nowhere, and no command carries its
own copy of the rule.

## Context

Surfaced on 2026-09-21 while closing TL-247, which made `takeDirFlag()` and
`takeColorFlags()` in the dispatcher stop at `--` (see
`scripts/tests/global-flags-separator.test.mjs`). That fix covers every command
that takes its directory through `takeDirFlag()` — around forty of them. It does
NOT cover the commands below, which never call it:

    scripts/done-task.mjs      `a === "--dir"` in parseDoneArgs — and the file
                               still IMPORTS takeDirFlag without calling it
    scripts/take-task.mjs      its own scan
    scripts/resume-task.mjs    RESUME_FLAGS, its own scan
    scripts/log-task.mjs       its own scan
    scripts/init-backlog.mjs   `argv.indexOf("--dir")` (line 442)
    scripts/build-backlog.mjs  `process.argv.indexOf("--dir")` (line 47)

`scripts/check-backlog-boards.mjs` has a seventh variant (`argValue("--dir")`)
but it is a guard rather than a user-facing command, so it is the least urgent
of the set.

WHY THEY ARE NOT SIMPLY REWRITTEN TO CALL `takeDirFlag()`. Some of them read
`--dir` inside a validating loop that also refuses unknown flags, and lifting
the flag out of that loop changes which message a bad invocation gets. The shape
of an unknown-flag refusal belongs to TL-220, so this task either preserves each
refusal exactly or waits for TL-220 to land first. That decision is the work.

WHY IT WAS NOT DONE INSIDE TL-247. That task's subject is the DISPATCHER —
`scripts/paths.mjs` and `scripts/cli.mjs`, above every command. Editing six
command parsers is a different blast radius, and two of the three files at the
top of the list were being changed by another session on the same day.

## Pre-flight reading

1. `scripts/paths.mjs` — `takeDirFlag()`, including the TL-247 paragraph that
   states why the scan stops at `--`.
2. `scripts/tests/global-flags-separator.test.mjs` — the cases the dispatcher
   already passes; the ones added here have the same shape, per command.
3. `scripts/done-task.mjs` — `parseDoneArgs()`, the most involved of the six,
   and the one whose unused import shows the intention was already there.

## Steps

1. Decide, and record in the history, whether the six parsers call
   `takeDirFlag()` or merely copy its two rules. Preserving today's refusal
   messages is a constraint, not an option.
2. Apply the decision to each of the six files.
3. One test per command: `--dir` past the separator is a value, and the write
   does not move. A positive control per case, because a command that refuses
   the whole invocation for an unrelated reason would otherwise look green.
4. Remove the unused `takeDirFlag` import from `scripts/done-task.mjs` if it
   stays unused.

## Acceptance criteria

- [ ] In each of the six commands, a `--dir` that follows `--` does not change
      the directory the command reads or writes, proved by one case per command.
      [proof: the-name]
- [ ] No command-level refusal message changes wording — the diff of the suite
      shows no expected-message edit. [proof: the-name]
