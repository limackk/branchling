---
id: TL-138
title: "Task file paths in pre-flight reading point at nothing"
type: task
labels: []
board: main
epic: ""
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-01
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:                      # HOW to check that the task is really done
  - id: tree-resolves
    bash: "for p in $(grep -rhoE 'backlog/tasks/TL-[0-9]+-[a-z0-9-]+[.]md' backlog/tasks/ | sort -u); do test -e \"$p\" || exit 1; done"
  - id: guard-catches
    bash: "node --test scripts/tests/dangling-refs.test.mjs"
---

## Goal

Every `backlog/tasks/...md` path written inside a task points at a file that
exists, and a path that does not is reported by `worktrail check` in the same
run as a dangling `blocked_by`.

## Context

Six of the twelve task-file paths written in `backlog/tasks/` point at nothing
(measured 2026-09-01, found while closing TL-125):

    TL-87-worktrail-next-atomowy-przydzial-taska-dla-agenta.md
    TL-90-worktrail-audit-deklaracje-kontra-slady-aktywnosci.md
    TL-93-bramka-weryfikacji-w-worktrail-close.md
    TL-94-worktrail-seed-plan-projektu-jako-wejscie-do-backlogu.md
    TL-96-worktrail-run-petla-next-agent-close-do-pustej-kolejki.md
    TL-99-worktrail-handoff-przekazanie-taska-z-powodem-i-sladem.md

They are all the same accident: the product rename rewrote `tasklog` to
`worktrail` in PROSE, and the filenames on disk still carry the old slug
(`TL-93-bramka-weryfikacji-w-tasklog-close.md`). Nothing caught it, because
`check --refs` reads `blocked_by:`/`blocks:` ids and not the paths in the body.

Why it is worth a guard rather than a one-off fix. A pre-flight path is the
one instruction a fresh session follows before it understands anything, and a
path that resolves to nothing costs that session a search — or, worse, gets
skipped. This is also a class that will recur: the next rename, or any
`renumber`, moves filenames again.

The decision to make in the task, not before it: whether a path is fixed by
resolving the id (the id is stable, the slug is not) or whether the reference
should stop being a path at all and become an id the reader resolves with
`worktrail query`. The second answer removes the class; the first keeps the
clickable link.

## Pre-flight reading

- `scripts/check-backlog.mjs` — where `--refs` already walks the tree; the new
  question belongs beside it, not in a second command.
- `scripts/tests/dangling-refs.test.mjs` — the existing coverage of the id
  case, and the shape a path case has to fit.

## Steps

1. Decide: repair the paths, or replace them with ids. State the reason.
2. Extend the guard so a path under `backlog/tasks/` that does not resolve is
   reported. It must FAIL rather than warn only if the repair is complete —
   a guard that starts red is one nobody runs.
3. Fix the six occurrences above.

## Acceptance criteria

- [x] No task file carries a `backlog/tasks/...md` path that does not exist. [proof: tree-resolves]
- [x] The guard reports a broken path, with a positive control: a deliberately broken path in a fixture is caught. [proof: guard-catches]
