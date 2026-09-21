---
id: TL-247
title: "Global flags are stripped from anywhere, separator or not"
type: bug
labels: []
board: main
epic: "CLI surface"
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude-opus-5
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - scripts/paths.mjs
  - scripts/cli.mjs
verification:                      # HOW to check the task is really done
  # REWRITTEN BECAUSE THE OLD BLOCK PASSED BEFORE ANY WORK WAS DONE (TL-260).
  # `node --test scripts/tests/paths.test.mjs scripts/tests/cli.test.mjs` was
  # GREEN against the unmodified tree on 2026-09-21 (35 tests, 0 failures): it
  # named the two FILES the defect lives in and not one case the defect makes
  # fail, so it could be satisfied by changing nothing. The first entry below
  # names a file whose four cases were all RED against the tree as found; the
  # second greps for the end-to-end case's own result line, so a renamed or
  # deleted test fails the entry instead of passing on a zero sample.
  - id: separator-cases
    bash: "node --test scripts/tests/global-flags-separator.test.mjs"
  - id: the-write-does-not-move
    bash: "node --test --test-name-pattern TITLED scripts/tests/global-flags-separator.test.mjs | grep -F '✔ a task can be TITLED'"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`--dir`, `--color` and `--no-color` are taken off the command line by the
dispatcher wherever they appear, including AFTER a `--` separator. Once TL-58
lands, every command-level parser will read `--` as "nothing after this is a
flag" while the dispatcher above them still does not — so one class of value is
still unwritable, and it fails in the worst way available: silently, by writing
somewhere else.

## Context

Measured on 2026-09-04 in this tree, with `takeDirFlag` called directly:

    takeDirFlag(["--title", "--", "--dir", "X"])
      -> { dir: "X", argv: ["--title", "--"] }

A user asking for a task titled `--dir` therefore gets neither a refusal nor
that task: the dispatcher eats the word as a flag, redirects the write into
whatever directory follows, and hands the command a `--title` with no value.
`takeColorFlags` and `foldAppendFlags` sit in the same position; `foldAppendFlags`
ALREADY stops at `--` (`scripts/cli.mjs`, the `passthrough` branch), and so does
`wantsHelp` — which is exactly why the other two reading the same line
differently is a defect rather than a design.

This surfaced while writing the failing test for
[TL-58](TL-58-a-value-starting-with-a-dash-fails-in-worktrail-new.md) and  <!-- former-name: allow -->
was deliberately kept OUT of it: TL-58 is one command's parser, this is the
dispatcher every command passes through, and a test that demanded both would
have made a two-hour task into a rewrite of the argument layer.

Low priority for the same reason TL-58 is: the values it blocks are the tool's
own flag names, and the workaround is rewording. It is on the list because the
failure mode is a write to the wrong directory with no message, which is a
worse shape of bug than the one TL-58 fixes.

## Pre-flight reading

1. `scripts/paths.mjs` — `takeDirFlag()`, the whole function.
2. `scripts/cli.mjs` — `takeColorFlags()`, `foldAppendFlags()` and `wantsHelp()`;
   the last two already handle the separator and are the shape to copy.
3. `TL-58` — the command-level half of the same convention; do not duplicate its
   decision, extend it.

## Steps

1. Stop `takeDirFlag()` and `takeColorFlags()` at the first `--`, the way
   `foldAppendFlags()` already does, leaving the separator in the arguments for
   the command below to read.
2. Decide, and record in the history rather than in prose, what
   `--dir X -- --dir Y` means. One reading is available: the first is the flag,
   the second is a value.
3. Tests in `scripts/tests/paths.test.mjs` for the pure function, and one
   end-to-end case proving a task can be titled `--dir` without the write moving.

## Acceptance criteria

- [x] `takeDirFlag` and `takeColorFlags` read nothing after `--` as a flag, and
      a case proves each one separately, each with a positive control showing
      the flag IS read before the separator. [proof: separator-cases]
- [x] A command run with a value of `--dir` after the separator writes into the
      directory the FIRST `--dir` named, and a second backlog directory that the
      word past the separator names stays empty. [proof: the-write-does-not-move]
- [x] Every other command still reads its arguments as it did — the separator is
      the only line that changed. [proof: suite]

