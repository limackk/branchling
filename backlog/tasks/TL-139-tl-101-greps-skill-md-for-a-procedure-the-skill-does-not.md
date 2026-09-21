---
id: TL-139
title: "TL-101 greps SKILL.md for a procedure the skill does not carry"
type: task
labels: []
board: main
epic: ""
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 30m                      # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: [TL-101]
related_docs: []
verification:                      # HOW to check that the task is really done
  - id: contract-holds
    manual: "TL-101's `verification:` can be satisfied without writing a procedure back into .claude/skills/backlog-workflow/SKILL.md — read both files and say which of the two the contract now measures"
---

## Goal

TL-101 carries a closing contract its own subject contradicts, and the
contradiction is settled — by rewriting the contract, or by cancelling the task
if it no longer has a thesis.

## Context

Found while closing TL-125 (2026-09-01), which put the real command name into
TL-101 — the gate is `worktrail done` and the working name TL-101 quoted never
existed — and deliberately went no further: the NAME was TL-125's thesis, this
is a different question.

TL-101 wants the skill `backlog-workflow` to instruct `take` and `done` instead
of hand-editing frontmatter, and it proves that with two greps over
`.claude/skills/backlog-workflow/SKILL.md`. That file, however, now holds no
procedure at all and says so in its own body: it exists so an editor that loads
skills by description knows a backlog is here, and it sends the reader to
`worktrail instructions overview`. The reason is stated there too — a copy of
the procedure in a skill file freezes on the day it was written and is then
wrong in the way that is hardest to notice.

So satisfying TL-101's contract as written means putting command names back
into the one file that was emptied on purpose. TL-125 did not change that; it only made the
command in the contract exist.

The decision is between three, and it is a decision, not a repair:

- the contract moves to what `worktrail instructions` PRINTS (the procedure
  really does live there now), and TL-101 becomes a task about those topics;
- the contract stays on SKILL.md but measures the pointer rather than the
  procedure — that the skill names the command that prints the guide;
- TL-101 is cancelled with a reason, because TL-87 and the `instructions`
  topics already delivered its goal by another route.

## Pre-flight reading

- `.claude/skills/backlog-workflow/SKILL.md` — what the skill deliberately does
  NOT contain, and why.
- `backlog/tasks/TL-101-skill-backlog-workflow-take-and-close-instead-of-manual.md`
  — the contract and the scope it was written for.
- `scripts/instructions.mjs` — the topics that now carry the procedure.

## Steps

1. Read both files and pick one of the three answers above.
2. Rewrite TL-101's `verification:` and scope, or cancel it with `--reason`.

## Acceptance criteria

- [x] TL-101 can be closed without writing a procedure back into `SKILL.md`, or it is cancelled with a stated reason. [proof: contract-holds]
