---
id: TL-13
title: "NOW.yaml computed instead of a focus field — \"what now\" without a bit to maintain"
type: task
labels: [post-launch, ops-hardening]
board: main
epic: ""
priority: P2
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node --test backlog/scripts/tests/boards.test.mjs"
  - bash: "node backlog/scripts/build-backlog.mjs && head -25 backlog/NOW.yaml"
  - manual: "Viewer → Dashboard: burndown has a pre-launch/post-launch/board/epic axis, and the word \"focus\" appears nowhere"
---

## Goal

Replace the manual `focus` field with a computed `NOW.yaml`. The founder's
question was: "someone who gets this backlog won't understand the focus
field" — and measurement confirmed it before anything was changed.

## Context

State before the change (measured, not estimated): 55 active tasks with
`focus: true` out of 337 active, 10 of them untouched since May; 11 flags
sat on `done` tasks; meanwhile **93 active P0/P1 tasks lay outside focus**.
The field therefore answered "what someone once declared", not "what we are
doing now". A manual bit that nobody clears always ends up in this state —
a computed value has no way to rot, because there is nothing left uncleared.

`NOW.yaml` has three sections, each answering a different question:
- `in_progress` — what has been **started** (43),
- `blocked` — what is waiting on a decision (12); this is also work: unblock
  it or cancel it,
- `next` — `pending` P0 (12), critical and not yet started.

Ordinary `pending` P1–P3 does not go into NOW — that's what INDEX is for.

**Deliberately no cap.** Truncating the list to 10 items would hide the fact
that 43 are started. The header NAMES it ("43 tasks in progress at once…
some of them are abandoned starts"), because that is the only thing the file
can do about a WIP leak it must not mask.

**Cost on the viewer side, resolved rather than left unspoken:** burndown
had `focus` as its default axis. The new default is `pre-launch` — it
answers the question the founder asks that curve most often ("how much is
left to ship") — and **board** was also added as a choice. Without this
decision the chart would show zero and lie that nothing was left. Old links
like `#dashboard?burn=focus` now fall back to the default axis instead of
drawing an empty chart.

Also removed: the "Focus" filter (7 facets → 6), the ★ badge on cards and in
detail view, the "Focus open" KPI (→ "In selected range"), the "Focus"
column in the epics table, the "focus" entry in the hours queue, and the
hygiene card "P0 outside focus" (→ "P0 untouched", i.e. exactly the `next`
section of NOW). The `focus*` variables in the dashboard described the
burndown range, not the field — renamed to `burn*`, so the name doesn't
suggest the field came back.

## Steps

1. `build-backlog.mjs` — `writeNow()` instead of `writeFocus()`, `focus`
   removed from the schema, a warning when the field reappears in
   frontmatter.
2. Migration: `focus:` removed from 1145 tasks and from `_template.md`;
   `FOCUS.yaml` and `boards/*/FOCUS.yaml` deleted.
3. `build-viewer.mjs` — every focus-related surface removed, new default
   burndown axis, board as an axis.
4. README (§2, §2.2, §3.3, §3.5, §5, §6.1, §6.2, quick-reference) + workspace
   `CLAUDE.md`.

## Acceptance criteria

- [x] `NOW.yaml` is produced with three sections, computed from status and
      priority; also per board.
- [x] `focus` does not occur in any task, in the template, in the generator,
      or in any view.
- [x] `FOCUS.yaml` removed from the repository.
- [x] Burndown has a working axis (pre-launch by default; post-launch,
      board, epic also selectable) — verified in the browser.
- [x] Tests: 33/33 green (5 new NOW cases; 3 old ones rewritten from FOCUS
      to NOW).

## Verification

```bash
node backlog/scripts/build-backlog.mjs && head -25 backlog/NOW.yaml
node --test backlog/scripts/tests/boards.test.mjs
```

Verified in the browser on the live viewer (2026-08-29): burndown
"pre-launch — 204 of 846 to do", KPI "In progress 43 — too many at once,
NOW.yaml warns", axis bar with no "focus" button, and the only occurrence of
the word "focus" visible in the UI is the title of the historical task TL-2.

## Notes

The generator **warns** when `focus:` reappears in frontmatter (a copied old
task) — without this the field would sneak back in through the back door and
a second, invisible definition of "what now" would start to grow. This is a
warning, not a guard: the field doesn't break anything, it simply means
nothing.

Sizes after the TL-12 (INDEX slimming) + TL-13 series: `INDEX.yaml` 69 KB
(was 149 KB), `NOW.yaml` 12 KB (FOCUS.yaml was 14 KB). An agent's default
read today is ~3k tokens and it tells the truth about the state of work.

`AGENTS.md` in the root has the same backlog section as `CLAUDE.md`, but it
is a file untracked by git (another session's work) — I did not touch it;
the change needs to be repeated there when it gets committed.

## Log

- 2026-08-29 number — claude — the task was created as TL-12, but a parallel
  session renumbered its own earlier task to this same number (the identity
  guard caught the collision on regeneration); rewired to TL-13
- 2026-08-29 done — claude — NOW.yaml + migration of 1145 tasks + focus
  removed from the viewer; burndown axis moved to pre-launch/board
