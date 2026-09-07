---
id: TL-363
title: "Every related documentation path resolves"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/check-docs-links.mjs, backlog/tasks/TL-321-guided-setup-selects-options-with-keys-and-fallback-text.md]
verification:                      # HOW to check the task is really done
  - id: docs-guard
    bash: "node scripts/cli.mjs check --docs"
---

## Goal

Every `related_docs` reference points to a real, relevant source file, so a
reader can follow a task's pre-flight path without silently losing context.

## Context

The documentation guard currently finds seven missing targets. Five completed
terminal UI tasks still point at the removed `scripts/terminal-ui.mjs`; two new
execution tasks were corrected in the planning commit. This task owns the
remaining stale references and any equivalent references found by the guard.

## Pre-flight reading

The documentation guard and each task that names a missing path, to replace a
stale implementation filename with the source that now owns the behavior.

1. `scripts/check-docs-links.mjs` — preserve the meaning of local paths and
   related-document references.
2. `backlog/tasks/TL-321-guided-setup-selects-options-with-keys-and-fallback-text.md`
   — establish why the old terminal UI path was named.

## Steps

1. Identify every unresolved `related_docs` entry reported by `check --docs`.
2. Replace each with its current implementation path, or remove it when it no
   longer contributes pre-flight context.
3. Run the documentation guard on this repository.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] The documentation guard reports no unresolved local targets. [proof: docs-guard]
