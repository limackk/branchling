---
id: TL-84
title: "Decide and record: is manually editing a task file a supported path"
type: task
labels: [pre-launch]
board: main
epic: "worktrail — the tool"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - CLAUDE.md
  - docs/worktrail-global-tool.md
verification:
  - manual: "One and the same sentence about manually editing a task file appears in the README and in the agent instructions — and it is possible to point to where the justification is recorded"
  - bash: "grep -rn 'by hand\\|manual' README.md docs/worktrail-global-tool.md | head"
---

## Goal

Have a recorded, explicit answer to the question "is it allowed to edit a
task file by hand" — one and the same answer in the README, in the agent
instructions, and in the tool's behavior.

## Context

Backlog.md answers this question firmly and repeats the answer in three
places (nudge, overview, execution guide): *"Do not edit Backlog markdown
files directly. Use the CLI so metadata, relationships, and history stay
consistent."* For them the CLI is the only legal write path.

We have the opposite model, and we have it **implicitly**. The file IS the
truth; `worktrail history --source manual` exists precisely to handle changes
made outside the tool; `_template.md` is a template meant to be filled in by
hand. Nowhere, however, is it written that this is a SUPPORTED path, not a
merely tolerated one — so every new writing command re-litigates the question
from scratch, differently each time.

This is not a task about code. It is a task about recording a decision before
TL-80, TL-82 and TL-83 start settling it quietly and inconsistently.

What needs to be weighed so the answer is not wishful thinking:

1. **The cost of our model.** Manual editing drifts computed fields and
   bypasses history. `history --source manual` patches this after the fact,
   and only when someone remembers to run it.
2. **The cost of their model.** The backlog stops being plain markdown —
   without the tool installed you cannot fix a typo, and a task in someone
   else's pull request stops being readable, editable content.
3. **A third option:** manual editing supported, but the tool detects the
   drift and reports it itself (`doctor` / `check`), instead of requiring
   someone to remember `history`. Check how much of this `doctor` already
   does.
4. Whatever comes out of this has to land in the **single** instruction
   source from TL-74 — not in three texts that can drift apart.

## Pre-flight reading

1. `scripts/history.mjs` and `scripts/history-record.mjs` — what today
   catches a change made outside the tool, and what it does not.
2. `scripts/doctor.mjs` — how much of the drift detection already exists.
3. `.claude/skills/backlog-workflow/SKILL.md`, the "Editing outside the
   viewer" section.
4. `docs/worktrail-global-tool.md` §3 — the four laws; check whether any of
   them already implies this answer, instead of inventing it from scratch.

## Steps

1. List out what actually breaks with manual editing (not hypothetically —
   check it on a file: computed fields, history, `updated`).
2. Check how much of this `doctor`/`check` detects today without needing
   `history` to be remembered.
3. Decide: supported / tolerated / unsupported. Record the justification.
4. Write the answer into the README and into the instruction source from
   TL-74 — one sentence, the same in both places.
5. If option 3 wins: open a separate task for drift detection. Do not do it
   here.

## Acceptance criteria

- [ ] The decision is recorded along with its justification and a list of
      what actually breaks.
- [ ] The README and the agent instructions say the same thing, in one
      sentence.
- [ ] It has been checked (not assumed) how much drift `doctor`/`check`
      detects today.
- [ ] Any work on drift detection is a separate task, not tacked on here.

## Log

2026-08-31 pending — agent:claude — from an analysis of Backlog.md: they
forbid manual editing and repeat that in three places; we have the opposite
model and have never written it down anywhere.
