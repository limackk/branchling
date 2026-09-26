---
id: TL-452
title: "The expanded viewer stays accessible responsive and honest"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-26
updated: 2026-09-26
blocked_by: [TL-450, TL-451]       # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: viewer-regression
    bash: "node --test scripts/tests/viewer-accessibility.test.mjs scripts/tests/viewer-script-syntax.test.mjs scripts/tests/viewer-storage-keys.test.mjs scripts/tests/viewer-mode-contract.test.mjs"
  - id: visual-qa
    manual: "Exercise all viewer tabs and one complete edit using only the keyboard in light and dark mode at desktop and 390px width, then open the generated file over file:// and confirm it is useful and clearly read-only."
---

## Goal

The restored dashboard and editing surface remain usable with a keyboard, screen reader, narrow viewport, reduced motion, dark mode and a disconnected or snapshot-only page, without hiding capability or failure behind colour.

## Context

The viewer is the only surface many non-technical readers will use. Adding charts and editors multiplies states that can look correct while being unusable: a save button reachable only by pointer, a dark-mode token that disappears, a chart whose meaning is only colour, or a snapshot that renders disabled controls without explaining why. This task is the cross-cutting release gate after the dashboard and editing work, not a place to add more product scope.

## Steps

1. Define keyboard order, focus treatment, labels and live announcements for tabs, filters, charts, editors, confirmations and refusals.
2. Give every chart a textual summary and every colour-coded state a word, pattern or icon.
3. Test snapshot, live, disconnected, loading, empty, error and stale-session states.
4. Verify desktop and narrow layouts without horizontal page scrolling, while allowing deliberate scrolling inside dense charts or histories.
5. Honor prefers-reduced-motion and preserve both system-driven colour themes.
6. Add a compact visual QA checklist to the viewer documentation.

## Acceptance criteria

- [ ] The generated page exposes the accessibility, mode and storage contracts in testable form. [proof: viewer-regression]
- [ ] The expanded viewer remains practically usable across its promised modes and layouts. [proof: visual-qa]
