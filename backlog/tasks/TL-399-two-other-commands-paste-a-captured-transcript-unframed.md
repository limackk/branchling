---
id: TL-399
title: "Two other commands paste a captured transcript unframed"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
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
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: transcripts-framed
    bash: "node --test scripts/tests/refusal-transcript.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Wherever this tool prints the captured output of a command it ran, a reader
can say per line whether the line came from that command or from this tool.
Today only `done` can.

## Context

TL-275 established the rule and applied it to `branchling done`: a failing
verification entry's transcript is written behind a gutter, inside a frame
that names the command, the exit code and the number of lines — so a `✗`
captured from a nested run of this tool cannot be read as a failure of the
run in progress. `transcriptBlock()` and `TRANSCRIPT_GUTTER` in
`scripts/done-task.mjs` are that mechanism, and they are exported.

Two other places still paste captured output with a two-space indent, which
is the shape the defect was made of:

- `scripts/resume-task.mjs`, the `failedOutput` branch of the briefing
  renderer (the block that pushes `"  " + line` for each line of
  `model.failedOutput`). `resume --verify` runs the same contract `done`
  runs, so it captures exactly the same transcripts, and it prints its own
  `✗` verdict lines a few rows above them.
- `scripts/probe.mjs`, which tails a failing command's output behind the same
  two spaces.

Neither is a refusal, so neither was inside TL-275's thesis; both are read by
somebody deciding what went wrong, which is the audience the framing is for.

## Pre-flight reading

1. `scripts/done-task.mjs` — `transcriptBlock()` and the comment above it:
   what the frame promises and why the line count is stated twice
2. `scripts/tests/refusal-transcript.test.mjs` — the predicate a framed
   transcript has to satisfy, and its positive control
3. `scripts/resume-task.mjs` — the briefing renderer and where `failedOutput`
   enters it
4. `scripts/probe.mjs` — the tail of a failing command

## Steps

1. Reuse `transcriptBlock()` rather than re-deriving the frame; a second
   spelling of the gutter is a second place for the two to drift apart.
2. Decide what `probe` does about the fact that it TAILS rather than prints
   whole — a frame that claims a line count must not claim one it truncated.
3. Extend the existing test file rather than starting a third one, so the
   predicate stays in one place.

## Acceptance criteria

- [ ] Captured output printed by `resume --verify` and by `probe` is
      distinguishable per line from those commands' own output, judged by the
      same predicate TL-275 wrote. [proof: transcripts-framed]
- [ ] The whole suite is green. [proof: suite-green]
