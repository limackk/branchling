---
id: TL-125
title: "TL-96 and TL-101 call worktrail close — no command by that name exists"
type: task
labels: []
board: main
epic: "Agent-facing differentiators"
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 30m                      # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: [TL-96, TL-101]
related_docs: []
verification:                      # HOW to check the task is really done
  - id: no-close-cmd
    bash: "! grep -rn 'worktrail close' backlog/tasks/ --exclude='TL-125-*' --exclude='TL-93-*'"
  - id: run-names-done
    bash: "! grep -qF 'close`, TL-93' backlog/tasks/TL-96-*.md"
  - id: gate-still-green
    bash: "node --test scripts/tests/verification-gate.test.mjs"
---

## Goal

No task in `backlog/tasks/` tells the reader to call `worktrail close`. The
command is named `done` and has never been named anything else — `close`
was a working name from tasks written before TL-82 implemented it.

## Context

Surfaced while closing TL-93 (2026-09-01). Two tasks this task just
unblocked carry that name:

- **TL-101** — its `verification:` block has the entry
  `grep -q 'worktrail close' .claude/skills/backlog-workflow/SKILL.md`.
  This is not a typo in prose, it is the closing contract: to satisfy it,
  whoever does the work would have to WRITE a nonexistent command into a
  skill. The verification gate would then force a bug into a file that
  ships into other people's repositories.
- **TL-96** — its `## Goal` describes the loop as "tries to close the task
  with the verification gate (`close`, TL-93)".

This task does NOT touch the prose of closed **TL-93** — it is a record of
a decision that was made, not debt to clean up; that is why its file is
excluded from the grep together with this task, which quotes that phrase.

No guard catches this class of bug: `worktrail check` checks ids, boards,
references, vocabulary, language and product name, but does not check
whether a command called in `verification:` even exists. That is a separate
question and a separate task — this one is about only the two known
occurrences.

## Steps

1. In TL-101: the `verification:` entry and the prose → `worktrail done`.
   Check along the way what it is actually meant to prove — a grep over
   SKILL.md is a contract on the skill's content, and the skill has
   deferred to `worktrail instructions` since TL-87.
2. In TL-96: `## Goal` → `done` instead of `close`; the reference to TL-93
   stays, because that is where the gate was closed.
3. `worktrail build`.

## Acceptance criteria

- [x] No OPEN task calls `worktrail close`. [proof: no-close-cmd]
- [x] The TL-101 contract can be satisfied without writing a nonexistent
      command into `.claude/skills/`. [proof: no-close-cmd]
- [x] TL-96's `## Goal` names the gate the same way the command is named.
      [proof: run-names-done]
- [x] The gate is still green after the change. [proof: gate-still-green]
</content>
