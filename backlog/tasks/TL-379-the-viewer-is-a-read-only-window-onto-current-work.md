---
id: TL-379
title: "The viewer is a read-only window onto current work"
type: task
labels: []
board: main
epic: "Evidence-gated product focus"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-08
updated: 2026-09-08
blocked_by: [TL-377, TL-378]
blocks: []                         # ids this task will unblock
related_docs:
  - README.md
  - scripts/build-viewer.mjs
  - scripts/serve-backlog.mjs
verification:
  - id: read-only-viewer
    bash: "node --test scripts/tests/viewer-read-only.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The optional browser viewer becomes a small read-only projection of current
work: the active queue, blockers, the active plan wave and questions waiting
for a person. It is no longer a second backlog application or a write path.

## Context

`scripts/build-viewer.mjs` is the largest source module and currently carries
editing, history, analytics, charts, plan exploration and worktree switching.
The evidence-gated product is used by technical teams whose authoritative write
surface is Markdown, CLI and Git review. A read-only page remains useful for a
person who needs current state without learning the CLI; browser mutation does
not strengthen the trust boundary and creates actor, validation and server
lifecycle obligations.

Do not create a new frontend framework. The result stays one self-contained,
computed page served on localhost. Removing generated views must remain safe.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/build-viewer.mjs` — inventory data and interaction paths before
   removing them.
2. `scripts/serve-backlog.mjs` — remove every mutation endpoint and retain the
   minimal static-serving boundary.
3. `scripts/viewer-plan.mjs` and `scripts/viewer-worktrees.mjs` — retain only
   what the reduced current-work page needs.
4. Viewer tests — preserve dark/light readability and prove there is no write
   request rather than only hiding buttons.

## Steps

1. Define one compact page containing current tasks, blockers, active wave and
   unresolved questions.
2. Remove field editing, write endpoints, activity/session panels, time-lapse,
   cross-project switching, rich historical charts and export-specific UI.
3. Delete now-unused rendering and server code instead of leaving hidden paths.
4. Keep URL filters only where they address the remaining task list.
5. Add a positive control that a former mutation request is refused and cannot
   change a fixture task.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] The viewer displays current tasks, blockers, active wave and unanswered
      questions from current task data. [proof: read-only-viewer]
- [ ] The served application exposes no task mutation endpoint or active editor.
      [proof: read-only-viewer]
- [ ] Telemetry, portfolio, export and historical-dashboard code is absent from
      the viewer bundle. [proof: read-only-viewer]
- [ ] A removed write request leaves its fixture byte-for-byte unchanged.
      [proof: read-only-viewer]
- [ ] The complete remaining suite passes. [proof: suite-green]
