---
id: TL-124
title: "A task card taken in another worktree looks free"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P2
status: done
owner: agent:claude
estimate: 2h
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/branchling-state-and-sync.md
verification:
  - id: suite
    bash: "node --test scripts/tests/viewer-elsewhere-card.test.mjs"
  - id: no-regression
    bash: "node --test scripts/tests/*.test.mjs"
  - id: manual-glance
    manual: "In a repo with a second worktree, where the task is taken: in the viewer's card list, this card is clearly dimmed relative to its neighbors, and a single glance does not read it as free to take"
---

## Goal

A task that has a different status in another worktree than it does here is
distinguishable in the card list WITHOUT reading badges. Today its local
status and the rest of the card look identical to a task that is genuinely
free.

## Context

TL-73 settled the semantics and they are not being revisited: the local
status stays, the divergence is SHOWN with the name of its source, the tool
never silently picks a winner. This task does not touch the semantics — it
only touches how strong this signal is visually.

Today the only carrier is the `elsewhere` badge in the card's footer
(`scripts/build-viewer.mjs:2700-2707`, `elsewhereHtml()` at 3223), next to
the status, type, labels, board, epic, and estimate badges. Badge number
seven in a row loses to the first impression: the card has normal contrast,
a normal title, a normal status — and the list reads as "these tasks are
free". The effect is measurable: a session takes a task that someone is
already working on, and the work happens twice — the same failure mode for
which CLAUDE.md has a rule about merging branches (TL-74, 2026-09-01, the
same task handed out to two sessions two minutes apart).

Decisions that BELONG to this task:

1. **The trigger is the EXISTENCE of a divergence, not a specific status.**
   It is not allowed to write "dim it when elsewhere is `in_progress`" —
   `pending` and `in_progress` are project VALUES from `config.yaml`, not
   facts about the code (Law III, `labels_closed`/statuses may differ in
   someone else's repo). The rule is a non-empty `elsewhere`, which is
   exactly what `divergences()` computes.
2. **Dimming must not masquerade as the graying-out of a closed status.** If
   the viewer already has a dimmed look for anything else, this one has to
   be distinguishable — otherwise the same look ends up with a second
   meaning.
3. **Accessibility.** Contrast alone is not a signal for someone with a
   color vision deficiency: the card also has to carry a non-color signal
   (border/pattern/`title`), and the badge stays as text.
4. **The selected card (`.active`) must stay legible** — dimming must not
   cancel out the selection.

Out of scope: dashboard counters (they count by local status —
deliberately, `stats` has a separate `divergent` field) and the table view.
If they turn out to be needed, they go in a separate task.

## Pre-flight reading

1. `scripts/build-viewer.mjs:2688-2712` — building the card and its footer.
2. `scripts/build-viewer.mjs:3223-3230` — `elsewhereHtml()`, the only
   current use of `elsewhere` on the card.
3. `scripts/build-viewer.mjs:761-800` — `.task-card*` styles.
4. `scripts/branch-scan.mjs:389-400` — `divergences()`, the definition of
   "differs".

## Steps

1. A class on the card when `t.elsewhere` is non-empty; the style in the
   same place as the other `.task-card*` rules, with a dark-mode variant.
2. A non-color signal + a `title` saying where the task is seen differently
   — with the same sentence as the badge, so that two different wordings do
   not appear.
3. Check a selected card and a dimmed card at the same time.
4. A test on the generated HTML/DOM: a fixture with a divergence gives the
   class on the card, a fixture without a divergence does NOT give it
   (positive and negative control — without it the guard passes on a zero
   sample).

## Acceptance criteria

- [x] A task card with non-empty `elsewhere` is visually distinguished from
      a card without a divergence. [proof: suite, manual-glance]
- [x] The rule does not know status names — the trigger is the divergence
      itself. [proof: suite]
- [x] The signal is legible without distinguishing colors and does not
      cancel the card's selection. [proof: suite, manual-glance]
- [x] The test has a positive and a negative control. [proof: suite]
- [x] The remaining tests are green. [proof: no-regression]
