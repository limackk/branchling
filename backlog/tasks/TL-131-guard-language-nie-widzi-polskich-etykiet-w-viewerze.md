---
id: TL-131
title: "The --language guard does not see Polish labels in the viewer"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: medium
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: labels-english
    bash: "node -e \"const s=require('fs').readFileSync('scripts/build-viewer.mjs','utf8');const m=s.match(/const HISTORY_FIELD_LABELS = \\{[^}]*\\}/);if(!m)process.exit(1);if(/utworzony|komentarz|zmieniony/i.test(m[0])){console.error(m[0]);process.exit(1)}console.log('labels are English')\""
  - id: guard-green
    bash: "node scripts/cli.mjs check --language"
---

## Goal

`worktrail check --language` passes green, and yet the viewer shows Polish
labels. In `scripts/build-viewer.mjs`, in the `HISTORY_FIELD_LABELS` map,
there are `__created__: "task utworzony"`, `created: "Utworzony"` — sitting
next to English entries (`__deleted__: "task deleted"`). This map ships into
other people's repositories in the generated page, so it is a PUBLIC SURFACE
(TL-32), and the guard does not catch it.

Once done: the labels are English AND the guard has a positive control that
fails when a Polish word is written into this map again.

## Context

Found during TL-99, when `__comment__: "komentarz"` was switched to
`"comment"` while implementing comments. The two remaining entries were left
because they were not part of that task's thesis.

More important than the fix itself is the QUESTION ABOUT THE GUARD:
`check --language` reads 30 thousand lines and rules "reads as English", and
it let these two lines through. It needs to be established why — the
heuristic may be skipping short strings, object interiors, or lines without a
verb. Fixing the labels alone without closing the gap leaves the guard green
with no evidentiary force (the rule from CLAUDE.md).

## Steps

1. Establish where `scripts/check-public-language.mjs` loses these two
   lines — start by feeding it them in isolation as a positive control.
2. Fix the labels to English in `scripts/build-viewer.mjs`.
3. Close the gap in the guard, or — if that turns out to be infeasible
   without false positives — add a narrower test on the map itself and
   describe in this task why the general rule cannot handle it.

## Acceptance criteria

- [ ] No value in `HISTORY_FIELD_LABELS` is in Polish. [proof: labels-english]
- [ ] Positive control: substituting a Polish label FAILS. [proof:
      labels-english]
- [ ] `check --language` still green after the change. [proof: guard-green]
