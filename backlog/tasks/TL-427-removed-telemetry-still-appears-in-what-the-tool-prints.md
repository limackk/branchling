---
id: TL-427
title: "Removed telemetry still appears in what the tool prints"
type: task
labels: []
board: main
epic: "CLI onboarding"
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
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
related_docs: [scripts/instructions.mjs, scripts/run-loop.mjs, scripts/home.mjs, scripts/history.mjs]
verification:                      # HOW to check the task is really done
  # Measured on THIS tree: the first entry fails today, because the sentence it
  # looks for is printed. It is not a fixture, so it cannot pass on an empty
  # sample.
  - id: printed-text-has-no-activity-log
    bash: "! node scripts/cli.mjs instructions autonomous-loop | grep -q 'activity log'"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Nothing the tool prints, and no comment explaining why it prints it, promises a
log or a report that TL-378 deleted.

## Context

The activity collection and the reports over it — `activity`, `focus`, `time`,
`sessions`, `session`, `actors`, `quote`, `backfill-completions` — were removed
by TL-378, and TL-394 took their entries out of `COMMANDS`. Text about them
survived in four places, three of which a user reads:

- `scripts/instructions.mjs` — `branchling instructions` tells the reader that
  the state directory holds "locks, the activity log, and this run's per-task
  agent logs". Nothing writes an activity log there any more.
- `scripts/run-loop.mjs` and `scripts/home.mjs` — the same sentence, as the
  stated reason for where the state directory lives. The reason is still good;
  the inventory naming it is not.
- `scripts/history.mjs` — the comment above `currentSession()` says "the
  `session <id>` report joins the two logs", explaining the one-derivation rule
  by a command that no longer exists. The rule is right and its justification
  now has to stand on the field itself, which
  `docs/backlog-field-editing-history.md` was corrected to do in TL-342.

Found while TL-342 swept the documents. It was not folded into that task: the
documents are one surface and what the binary prints is another, and a task that
verified neither in particular would have blurred both.

Do not delete the sentences and leave a gap. Each one is answering a question —
what the state directory is for, why a session id is derived once — and the
answer has to survive the removal of the example.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/instructions.mjs` — the printed text, which is the only one of the
   four a user meets.
2. `scripts/home.mjs` — the state directory's rationale in its fullest form.
3. `scripts/history.mjs` — `currentSession()` and the comment above it.
4. `docs/backlog-time-tracking.md` — what the removal note already says, so the
   replacements agree with it.

## Steps

1. Correct the three inventories of the state directory to what is written
   there now.
2. Rewrite the `currentSession()` comment so the one-derivation rule rests on
   the `session` field rather than on a deleted report.
3. Check the same words elsewhere — `grep -rn "activity log" scripts` — before
   calling it done.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] No text `branchling instructions` prints names the activity log or a
      report over it. [proof: printed-text-has-no-activity-log]
- [ ] The state directory's inventory in `run-loop.mjs` and `home.mjs`, and the
      `currentSession()` comment, each keep their reason without the deleted
      command. [proof: suite-green]
- [ ] The suite is green. [proof: suite-green]
