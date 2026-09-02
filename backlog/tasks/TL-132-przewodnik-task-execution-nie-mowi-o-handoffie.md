---
id: TL-132
title: "The task-execution guide does not mention handoff"
type: task
labels: []
board: main
epic: "Agent-facing differentiators"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: medium
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-99]
blocks: []
related_docs: []
verification:
  - id: guides-render
    bash: "node --test scripts/tests/instructions.test.mjs"
---

## Goal

`worktrail instructions task-execution` lists, in the "WHILE YOU WORK"
section, what to do when scope grows and when a blocker is hit — but does
not say what to do when a decision is OUTSIDE the executor's mandate. A
command for this has existed since TL-99 (`worktrail handoff`), and the
guide does not know about it, so no session will use it: the guide is the
only place an agent learns the procedure from.

Once done: the guide lists handoff as a third response alongside "new task"
and "blocked".

## Context

Grew out of TL-99, deliberately left outside that scope because it needs a
separate design decision: **roles are optional**. In a backlog without
`roles:` in `config.yaml` (like this one), `handoff --to-role` fails by
definition, so a line printed unconditionally would be teaching a command
that cannot be called in this project — exactly the same class of bug as
promising a flag that does not exist.

Guides are rendered with the PROJECT's vocabulary (`scripts/instructions.mjs`,
`vocabulary()` + `render()`), and the substitution mechanism has no
conditionals today: `render()` only knows `{{key}}` and THROWS on an
unknown one. So one thing needs to be decided:

- either the text is unconditional and phrased so it is true even without
  roles (e.g. it talks about `handoff --to-owner`, which always works),
- or `instructions.mjs` gets conditional sections — which is a change to
  the mechanism, not the text, and would then need its own test of both
  branches.

Recommendation: start with the first variant. Conditional sections are new
machinery for one paragraph.

## Steps

1. Add a line to "WHILE YOU WORK" in `TASK_EXECUTION` in
   `scripts/instructions.mjs`.
2. If the text is to mention roles — add a placeholder to `vocabulary()`
   and a render test for a backlog WITHOUT `roles:` and with them.
3. Check whether `overview` needs a sentence about the same thing.

## Acceptance criteria

- [ ] `instructions task-execution` lists handoff as the response to "a
      decision outside the mandate". [proof: guides-render]
- [ ] The text is true in a backlog WITHOUT `roles:` — it promises nothing
      that is not there. [proof: guides-render]
- [ ] Every topic still renders without an unknown placeholder.
      [proof: guides-render]
</content>
