---
id: TL-423
title: "The main help promises --dir on every command, and regen-hook takes none"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: help-and-command-agree
    bash: "node --test scripts/tests/help-covers-flags.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`branchling --help` ends with "`--dir <path>` points at a different backlog; it
works on every command." It does not work on `regen-hook`, which since TL-220
refuses it with exit 2 — before that it was accepted and ignored, which is worse.

Once this is done the sentence and the tool agree: either `regen-hook` takes
`--dir`, or the promise names its one exception.

## Context

Found on 2026-09-21 while closing TL-220, which gave `regen-hook` the argument
validation it had never had. `regen-hook` resolves the backlog from the EDITED
FILE's path — `backlogForTaskPath()` in `scripts/paths.mjs` — because an editor
hook fires from wherever the editor happens to stand. A `--dir` would be a
second answer to a question the payload already settles, and the two disagree
the first time a hook fires from another worktree. That is the argument for
leaving the command as it is and correcting the sentence instead; the opposite
argument is that a blanket promise with a silent exception is the kind of claim
a guard cannot check, and `scripts/tests/help-covers-flags.test.mjs` exempts
`--dir` on every command BECAUSE of that sentence.

This is not TL-220's thesis (one shape for a refusal) and not TL-217's (the
accepted set equals the declared set): both are about a command describing
itself, this is about the main help describing all of them.

## Pre-flight reading

1. `scripts/cli.mjs` — `helpText()`, the last two lines, where the promise is
   made; and the `regen-hook` entry of the command table.
2. `scripts/regen-hook.mjs` — `unknownArgument()` and the comment above it
   saying why `--dir` is refused rather than accepted.
3. `scripts/tests/help-covers-flags.test.mjs` — `GLOBAL_FLAGS` and the positive
   control "the main help still carries the global flags", which reads that
   sentence and would have to read the corrected one.

## Steps

1. Decide between the two: `regen-hook` accepts `--dir` (and the payload wins
   when they disagree, or the command refuses when they do), or the main help
   names the exception.
2. Whichever way, the assertion in `help-covers-flags.test.mjs` has to keep
   matching the sentence it checks.

## Acceptance criteria

- [ ] `branchling --help` and `regen-hook` agree about `--dir`, and a test fails
      if they stop agreeing. [proof: help-and-command-agree]
- [ ] The suite stays green. [proof: suite-green]
