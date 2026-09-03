---
id: TL-177
title: "A project switcher in the viewer over the cross-project pass"
type: code
labels: [post-launch]
board: main
epic: "Backlog viewer"
priority: P3
status: pending
owner: unassigned
role: ""
executor: ""
estimate: 1d
confidence: low
created: 2026-09-03
updated: 2026-09-03
blocked_by: [TL-176]
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - id: viewer-project-column
    bash: "node --test scripts/tests/viewer-projects.test.mjs"
---

## Goal

The viewer can show one project or all of them, over the same pass the terminal
uses — a "project / all" switcher, with every row identified by the pair
(project, id).

## Context

TL-36 delivered the cross-project pass in the terminal and its `--json`, which
is the extension surface (law 4) the viewer is supposed to build on. Step 6 of
that task named the viewer explicitly and put it AFTER the CLI, and none of its
acceptance criteria covered it — so it is here rather than folded into a task
that was already closed on its own contract.

The constraint carried over unchanged: **this is a view, not a second source of
truth.** The page assembles what it is given; it stores nothing, caches nothing
and must not become a reason the registry cannot be deleted.

Blocked by TL-176 deliberately. The measurement that closed TL-36 found 1239
registered projects on this machine, 347 of them dead — a switcher offering that
list is unusable, and the fix belongs in the registry rather than in a filter
written into the page.

## Pre-flight reading

1. `scripts/cross-project.mjs` — `collectAllProjects()`, and the shape of
   `unavailable`.
2. `scripts/build-viewer.mjs` — `readTasks()`, and the pattern of pasting a
   module into the page by source.
3. `scripts/tests/cross-project.test.mjs` — what the pass already guarantees,
   so the page is not tested for it a second time.

## Steps

1. A project column and a switcher, off by default: one project is what the
   viewer is opened on.
2. Unavailable projects shown in the page, not only counted — the same rule the
   terminal follows.
3. The switch is part of the URL view state, like every other filter.

## Acceptance criteria

- [ ] Two projects sharing a task number produce two rows, each naming its
      project. [proof: viewer-project-column]
- [ ] An unavailable project is visible in the page. [proof: viewer-project-column]
- [ ] With no registry the page still opens on the backlog it was built from. [proof: viewer-project-column]

## Decisions

- After the CLI, never instead of it: the terminal answer and its `--json` are
  the contract, and a page that computed its own would be a second definition of
  a row.
