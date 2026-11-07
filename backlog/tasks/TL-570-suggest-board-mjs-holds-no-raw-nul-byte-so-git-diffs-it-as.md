---
id: TL-570
title: "suggest-board.mjs holds no raw NUL byte, so git diffs it as text"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-3
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: no-nul
    bash: "node -e \"process.exit(require('fs').readFileSync('scripts/suggest-board.mjs').includes(0) ? 1 : 0)\""
  - id: board
    bash: "node --test scripts/tests/json-envelope.test.mjs"
---

## Goal

scripts/suggest-board.mjs contains no literal NUL byte, so git diffs it as text and a review of a change to it shows the lines instead of `Bin 7537 -> 7597 bytes`.

## Context

Line 98 of scripts/suggest-board.mjs, in the glob-to-regex conversion, uses a raw U+0000 character typed into the source as a placeholder for `**` (`esc.replace(/\*\*/g, "<NUL>")...replace(/<NUL>/g, ".*")`). Two raw NUL bytes make git classify the whole file as binary: `git diff --stat` prints `Bin`, `git diff` prints no hunks, and grep reports `binary file matches`. TL-548 changed one unrelated line of this file and its review diff was unreadable for that reason. The fix is the escape sequence `\u0000` (or any placeholder that cannot occur in an escaped glob) in place of the raw byte; the behaviour of `board --paths` must not change.

## Steps

1. Replace both raw NUL bytes on line 98 with the escape `\u0000` in the regex and the string literal
2. Confirm `git diff --stat` on a one-line change to the file reports a line count, not `Bin`
3. Run the board tests

## Acceptance criteria

- [x] The source file holds no NUL byte. [proof: no-nul]
- [x] The board answer, which the envelope suite exercises with a paths rule, is unchanged. [proof: board]
