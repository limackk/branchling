---
id: TL-207
title: "the decision panel shows a question's options, not only its text"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: [TL-204]               # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: panel-options
    bash: "node --test scripts/tests/decision-panel.test.mjs"
---

## Goal

The decision panel's rows carry a question's options and which one was
recommended, and the viewer renders them. A reader who opens the panel to
answer a question sees the menu the asker offered, not only the prose.

## Context

TL-204 gave `branchling ask` `--option` (repeatable) and `--recommend <n>`, both
recorded in the question's `__comment__` event, and `branchling decide
--choose <n>` answers by picking a row. Two readers already show the menu: the
terminal output of `ask`, and the task file as printed by `take` and `next`
(`withDecisions` in `scripts/decisions.mjs`).

The decision panel does not. `decisionPanel()` in `scripts/decision-panel.mjs`
builds a `kind: "question"` row out of the event, and it copies `question`,
`asked`, `asker` and `ageDays` — but not `options` or `recommend`, so the data
stops there and the viewer has nothing to render even if it wanted to.

That leaves the panel reproducing exactly the defect TL-204 was written about:
a person opens "waiting on you", reads a question whose candidate answers were
already worked out, and has to reconstruct them from the prose. The panel is
the surface a NON-TECHNICAL reader answers from — the one least able to go and
read `history/<ID>.jsonl` for the rest of the question.

It was left out of TL-204 deliberately rather than forgotten: the viewer is a
separate surface with its own skill and its own test shape, and adding fields
to a row nothing rendered would have been speculative data.

## Pre-flight reading

1. `scripts/decision-panel.mjs` — `decisionPanel()`, the `kind: "question"`
   row. Note the module's constraint: it is PASTED into the viewer page by
   source, so it may import nothing but `task-fields.mjs`.
2. `scripts/decisions.mjs` — `withDecisions()` already renders a menu, with the
   recommended row marked. The panel should not disagree with it about wording.
3. `scripts/build-viewer.mjs` — where the panel's rows become HTML; search for
   `decisionPanel`.
4. `backlog/tasks/TL-204-*.md` — why the options live in the event and not in
   the task file, and why the numbering is 1-based at every end.

## Steps

1. Carry `options` and `recommend` from the question event onto the panel row.
2. Render them in the viewer's decision panel, marking the recommended row with
   a WORD and not only a colour, and keeping the numbers the ones
   `decide --choose` takes.
3. Where the viewer can answer a question, offer the menu rather than only a
   free-text reason.
4. Extend `scripts/tests/decision-panel.test.mjs` — with a positive control: a
   question asked with NO options must still render, and invent none.

## Acceptance criteria

- [ ] A panel row for a question asked with options carries them, in order,
      and names the recommended one. [proof: panel-options]
- [ ] A question asked without options renders with no invented menu.
      [proof: panel-options]
- [ ] The suite stays green. [proof: suite-green]
