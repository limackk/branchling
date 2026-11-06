---
id: TASK-1
title: "Adjust the vocabularies in config.yaml to your project"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: doctor-clean
    bash: "branchling doctor"
  - id: config-is-yours
    manual: "config.yaml names THIS project — project_name, task_id_prefix and statuses are no longer the defaults"
---

## Goal

Set the backlog up for YOUR project — and, along the way, see what a task looks
like in this tool.

**This file is an example.** Delete it once it stops being useful; nothing
depends on it.

## Context

`config.yaml` holds this project's vocabularies: statuses, priorities, labels,
the task number prefix. The code knows the SHAPE of a field, that file knows the
VALUES — so adapting the tool means editing that file, not the code.

Next to every key stands the cost of changing it. The cheapest moment to change
`task_id_prefix` is NOW, while the backlog is empty: later the same change
requires renumbering the tree.

## Steps

1. Open `config.yaml` and read the legend at the top.
2. Set `project_name` and `task_id_prefix` to your own.
3. Adjust `statuses` to how you actually work — together with
   `archived_statuses` and `dashboard_open_statuses`.
4. Run `branchling doctor`. It will say whether anything has come apart.
5. Delete this file and create your first real task:
   `branchling new --title "…"`.

## Acceptance criteria

Each one names the `verification:` entry that proves it; the tool ticks it after
a green run, so a checkbox here is evidence and not a claim.

- [ ] `branchling doctor` finishes with no errors. [proof: doctor-clean]
- [ ] `config.yaml` describes this project, not the defaults. [proof: config-is-yours]
