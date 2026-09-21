---
id: TL-395
title: "The backlog still calls the tool by a name it no longer has"
type: task
labels: []
board: main
epic: "Repository readability"
priority: P2
status: done
owner: agent:claude
role: ""
executor: ""
estimate: 4h
confidence: low
created: 2026-09-21
updated: 2026-09-21
blocked_by: []
blocks: []
related_docs: [LINEAGE.md]
verification:
  - id: open-tasks-name-the-tool-correctly
    bash: "node --test scripts/tests/former-name.test.mjs"
  - id: the-decision-is-an-event
    bash: "grep -q __decision__ backlog/history/TL-395.jsonl"
---

## Goal

A stranger reading this backlog is told which tool it is about, and told it
once. Today they are told `worktrail` 659 times, and no such thing ships.  <!-- former-name: allow -->

## Context

`worktrail` was this tool's name. The product name now comes from  <!-- former-name: allow -->
`scripts/product.mjs`, read from `package.json`, and `branchling check
--product-name` enforces that — over `scripts/` and `bin/` only. `backlog/` was
never inside that guard, so 138 task files kept the old name, 30 of them in the
title. Five of those tasks are open; the other 133 are archived.

Those two groups are not one problem, and the reason they are separated here is
that the second one is a real decision.

THE FIVE OPEN TASKS ARE STRAIGHTFORWARD. They are work somebody may pick up
tomorrow, and an instruction to run `worktrail done` is an instruction that  <!-- former-name: allow -->
fails. Fix them.

THE 133 ARCHIVED ONES ARE A QUESTION, AND THIS TASK DOES NOT ANSWER IT.
LINEAGE.md states that the tasks ARE this tool's development history, because
the git history was flattened at extraction — which is the argument FOR the
rename: the history a stranger reads should name the thing they installed.
Against it: a task written on 2026-09-01 saying `worktrail done` is an accurate  <!-- former-name: allow -->
record of what the command was called that day, and rewriting it makes the
record assert something that was never true. That is the same hazard AGENTS.md
documents for `renumber` — a rewritten id still exists and names a DIFFERENT
task — seen from the naming side.

There is precedent on both sides. TL-137 rewrote 145 task files wholesale, so
mass editing of task prose is an accepted operation here; and `backlog/history/`
is exempt from every such pass, so append-only evidence is not. An archived task
file is neither of those, which is why somebody has to choose rather than infer.

WHAT IS NOT IN SCOPE. `backlog/history/*.jsonl` — append-only, and the one
rewrite this project ever allowed there was a foreign project's name, not its
own former one. Filenames are TL-385.

## Pre-flight reading

1. `scripts/product.mjs` and `branchling check --product-name` — what the guard
   covers and where its boundary is drawn, so extending it is a decision made
   with the original reasoning in view.
2. AGENTS.md, "The product name comes from `scripts/product.mjs`" — in
   particular the two identities, `PRODUCT_NAME` and the frozen
   `BLOCK_MARKER_NAME`, so a pass does not rewrite the second.
3. LINEAGE.md — why the task files carry the weight of a git history here.

## Steps

1. Fix the five open tasks.
2. Record the choice about the 133 archived ones as a `__decision__` event, with
   its reason, before touching any of them.
3. If the choice is to rewrite: do it, and extend `check --product-name` to
   `backlog/tasks/` so the boundary that allowed this stops allowing it. If the
   choice is to keep them: extend the guard to open tasks only, and say in
   AGENTS.md that an archived task names the tool of its own day.

## Acceptance criteria

- [x] No open task names the tool by a name it no longer has.
      [proof: open-tasks-name-the-tool-correctly]
- [x] The decision about archived tasks is an event in
      `backlog/history/TL-395.jsonl`, not an argument in this file.
      [proof: the-decision-is-an-event]
