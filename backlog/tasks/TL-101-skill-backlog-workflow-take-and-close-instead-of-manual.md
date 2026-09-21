---
id: TL-101
title: "Skill backlog-workflow: take and close instead of manual editing"
type: task
labels: []
board: main
epic: "Agentic hallmarks"
priority: P2
status: done
owner: agent:claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: [TL-87, TL-93]
blocks: []
related_docs: []
verification:
  - id: guides-say-primitives
    bash: "node --test scripts/tests/instructions.test.mjs"
  - id: skill-points-at-the-guide
    bash: "grep -q 'worktrail instructions overview' .claude/skills/backlog-workflow/SKILL.md"
---

## Goal

The guides an agent reads before working and before closing a task REQUIRE it
to use the primitives (`take`, `done`) and describe manual field editing as
the fallback path — and this is enforced by a test, not merely true on the
day someone wrote it.

Direct mode ("do TL-1234" said to the main agent in Claude Code / Codex) gets
a lock, attribution, and session focus for free this way — fewer steps for
the agent, better traces for the human.

## Context

Task rewritten on 2026-09-01 following the resolution of TL-139; the previous
scope (rewriting the "Work a task" and "Close a task" sections in
`.claude/skills/backlog-workflow/SKILL.md`) is OUTDATED, because those
sections no longer exist. The skill deliberately carries no procedure or
vocabulary and points to `worktrail instructions overview`; the reason is
stated in its own body — a copy of the procedure inside the skill file
freezes on the day it was written, and then misleads in the worst possible
way: still specifically, still confidently.

The content the original TL-101 wanted HAS already been delivered — just
elsewhere. `instructions task-execution` says outright "Do not edit the
status by hand to claim it" and gives `next`/`take`; `instructions
task-finalization` says "ONE COMMAND CLOSES A TASK" and forbids doing those
steps by hand; both point to `worktrail history --source manual` as the path
for changes made by hand. So there is no prose work left to do — what is
missing is PROOF that it stays that way.

Because nothing guards it. `scripts/tests/instructions.test.mjs` checks
routing from `overview`, vocabulary substitution, and that an unknown
placeholder crashes instead of reaching the terminal — but not a single
assertion that the guides actually require using `take`/`done` instead of
editing fields. The sentence the entire direct mode rests on could be deleted
today in one commit and the suite would stay green.

Boundary: this is a guard over the guide's THESIS, not its wording. An
assertion on the whole sentence would force a test update at every style
edit, so it would be the first thing someone loosens.

## Pre-flight reading

- `scripts/instructions.mjs` — the `task-execution` and `task-finalization`
  topics; this is where the sentences this task guards live.
- `scripts/tests/instructions.test.mjs` — what the suite already proves and
  in what convention (a positive control for every claim).
- `.claude/skills/backlog-workflow/SKILL.md` — why the skill does NOT carry a
  procedure; the contract for this file measures only the pointer.

## Steps

1. In `instructions.test.mjs`: an assertion that `task-execution` carries a
   ban on manually changing status and gives `take`/`next`, and that
   `task-finalization` says closing is one command that runs the contract.
   Take command names from `PRODUCT_NAME` and the command table, not from
   literals.
2. Positive control: the assertion must FAIL when the sentence disappears
   from the template — a test that passes on empty text is green with no
   evidentiary force.
3. Check whether the guides describe manual editing as the fallback path
   (`history --source manual`); if not — add one sentence, not an essay.

## Acceptance criteria

- [x] `task-execution` requires taking a task via a command and forbids
      manually changing status; the guard fails when that sentence
      disappears. [proof: guides-say-primitives]
- [x] `task-finalization` says closing is one command running
      `verification:`. [proof: guides-say-primitives]
- [x] The skill carries no procedure — its contract checks only that it
      points to the guide. [proof: skill-points-at-the-guide]
- [x] No `verification:` entry requires writing the procedure back into
      `.claude/skills/`. [proof: skill-points-at-the-guide]

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 blocked — agent:claude — task created from the decision on
  direct mode; waiting on take (TL-87) and close (TL-93).
