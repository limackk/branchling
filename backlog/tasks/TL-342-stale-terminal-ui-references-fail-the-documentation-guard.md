---
id: TL-342
title: "Stale terminal UI references fail the documentation guard"
type: task
labels: []
board: main
epic: "CLI onboarding"              # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/agent-profiles.mjs, scripts/ui.mjs] # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: documentation-links
    bash: "node scripts/cli.mjs check"
---

## Goal

The five guided-setup tasks that introduced the polished terminal flow point to
`scripts/terminal-ui.mjs`, a module that no longer exists. Every pre-flight
reference names the current owner of the behavior, and `branchling check` finds
no dangling documentation targets.

## Context

The documentation guard reports the same absent target in TL-321, TL-323,
TL-324, TL-325, and TL-326. The interaction implementation now lives in the
setup and presentation modules, rather than in a standalone terminal-ui module.
Do not recreate a compatibility file just to satisfy links: that would give
readers a second, false owner for the behavior. Update both `related_docs` and
the prose pre-flight entries to the module that actually answers each purpose.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/agent-profiles.mjs` — guided setup choices and their interaction
   boundaries.
2. `scripts/ui.mjs` — shared terminal rendering ownership.
3. `scripts/watch.mjs` — non-interactive terminal rendering boundary used by
   TL-323.
4. `backlog/tasks/TL-321-guided-setup-selects-options-with-keys-and-fallback-text.md`
   — the first stale reference and its intended responsibility.

## Steps

1. Locate each reference to `scripts/terminal-ui.mjs` in the five affected
   task files.
2. Replace it with the current module that owns the behavior described beside
   the reference; revise the description where necessary so it remains true.
3. Run the documentation guard across the complete backlog.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] No task file refers to `scripts/terminal-ui.mjs`. [proof: documentation-links]
- [ ] `branchling check` reports no dangling documentation targets. [proof: documentation-links]
