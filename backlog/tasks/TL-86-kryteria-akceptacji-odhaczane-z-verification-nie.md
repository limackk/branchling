---
id: TL-86
title: "Acceptance criteria checked off from verification, not declared by hand"
type: code
labels: [pre-launch]
board: main
epic: "Data integrity"
priority: P0
status: done
owner: agent:claude
estimate: 3h
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: [TL-82]
related_docs:
  - _template.md
  - CLAUDE.md
verification:
  - id: mapping-tests
    bash: "node --test scripts/tests/criteria-mapping.test.mjs"
  - id: guard-green
    bash: "node scripts/cli.mjs check --criteria"
  - id: closed-untouched
    bash: 'grep -lE "^status: (done|cancelled)" backlog/tasks/*.md | xargs grep -l "\[proof:" && { echo "the mechanism was applied to a closed task"; exit 1; }; echo "no closed task carries a proof link"'
  - id: doc-distinction
    bash: "grep -q 'Computed is not the same as reconstructible' docs/worktrail-global-tool.md"
---

## Goal

An acceptance criterion stops being something that is declared and becomes
something that is earned: it points to a `verification:` entry that proves it,
and the tool checks it off after a green run. The checkbox can no longer lie.

## Context

Measurement on the project's own backlog (2026-08-31, 83 tasks):

```
closed (`done`):                          44
with UNCHECKED acceptance criteria:       12   (27%)
unchecked items total:                    60
without a single `bash:` entry:            2
with a template literal in `verification`: 1
```

The canonical case is TL-51: closed, committed, six criteria unchecked — while
`verification:` consists of three real commands that check exactly those six
things. The work was verified. The decoration was not checked off.

**Diagnosis: this is not sloppiness, it is a correct reaction to the design.**
We have two lists about the same "done" — `## Acceptance criteria` and
`verification:` — and no defined relationship between them. One is real, so
the other is ignored. 27% is a measure of redundancy, not discipline.

A consequence invisible without this measurement: `worktrail done` from TL-82
would let TL-51 through with six dead checkboxes, because the gate looks only
at `verification:`. That is why this task blocks that one — otherwise the
closing behavior would be designed twice.

Backlog.md has the same problem and solves it with prose: "check only the
acceptance criteria that the verification evidence proves." That is a request
for honesty. We can make there be nothing to ask for — the same axis
(instruction versus mechanism), one floor down.

Rejected alternative: **remove `## Acceptance criteria` from the template**
and keep only `verification:`. Cheaper, and it also removes the redundancy,
but criteria carry intent in human terms ("a new command without help fails"),
while a command carries only the check. A loss for someone who is only
reading the task. If it turns out during implementation that the link is more
expensive than it looks, this option comes back to the table — but then
deliberately, and with a log entry.

## Four things to settle — each one can sink this change

1. **What identifies a criterion.** A list item's position in the markdown is
   fragile: inserting a criterion in the middle silently shifts every link
   after it. Consider a stable identifier on the criterion, or the reverse
   direction — the criterion points to the verification entry, not the other
   way around. Choose whatever survives the list being reordered.
2. **Migration.** 39 active tasks have no link at all. Turning on the
   requirement overnight makes all of them UNCLOSABLE — that is how this
   change dies within a week. Decide: the requirement applies only to tasks
   created after the change, a warning mode before a failing mode, or a
   one-time backfill. Do not touch the 44 already closed.
3. **An empty criteria list must not pass.** A task with no criteria would
   pass this gate trivially — exactly the guard green on a zero sample that
   CLAUDE.md warns against. No criteria must fail just as an empty
   `verification:` does.
4. **A checked-off checkbox is written to a versioned file, even though it is
   computed** — an apparent tension with Law II. It is not: this is not a
   view, it is a RECORD OF A RUN that took place. A view may be deleted and
   rebuilt; the result of a past run cannot be reconstructed without running
   it again. Write down this distinction so the next reader does not take it
   for a violation.

## Pre-flight reading

1. `backlog/tasks/TL-51-*.md` — the canonical case of the mismatch; read both
   blocks side by side before designing the link.
2. `_template.md` — the `## Acceptance criteria` section and the
   `verification:` block.
3. `scripts/task-fields.mjs:146` — how `verification` is validated today; the
   link has to go through the same validation.
4. `backlog/tasks/TL-82-*.md` — the closing gate that will consume this.
5. `docs/worktrail-global-tool.md` §3 — Law II, for resolving point 4.

## Steps

1. Decide how a criterion is identified (point 1) and write down the reason.
2. Extend the `verification:` schema with the link; an unknown key still fails.
3. `_template.md` — show the link in the example, not in a comment.
4. `worktrail check --criteria`: a criterion without proof, proof without a
   criterion, an empty criteria list. Start as a warning if that is how the
   migration turns out.
5. Decide and implement the migration (point 2). Do not touch closed tasks.
6. Hand off to TL-82: what the gate should check off and where it should
   refuse.
7. `scripts/tests/criteria-mapping.test.mjs`: a criterion without proof fails;
   an empty criteria list fails; reordering the criteria list does NOT break
   the links (this is the test for point 1 — if it passes with list-position
   numbering, it is testing the wrong thing); checking off writes to the file
   once, idempotently.

## Acceptance criteria

- [x] Every criterion points to a proof, and the link survives the criteria list being reordered. [proof: mapping-tests]
- [x] A criterion without proof, proof without a criterion, and an empty criteria list are all detected by `check`. [proof: mapping-tests]
- [x] The migration path for the 39 active tasks is decided and does not make them unclosable. [proof: guard-green]
- [x] Closed tasks are not modified. [proof: closed-untouched]
- [x] The distinction "a view may be deleted, a run record may not" is written into the documentation. [proof: doc-distinction]
- [x] The test fails if the link relies on a fragile list-position number. [proof: mapping-tests]

## Log

2026-08-31 pending — agent:claude — created after measuring the project's own backlog: 12 of 44 closed tasks have 60 unchecked criteria between them, alongside a working `verification:`. Two lists about the same thing, only one of them real. Blocks TL-82, because it changes what the gate is supposed to check.
2026-09-01 in_progress — agent:claude — taken as the first executable P0: TL-48 is waiting on an owner (repository address), TL-81 is by definition a decision task. This one is code and unblocks TL-82.
2026-09-01 done — agent:claude — FOUR DECISIONS, each with a reason, not with taste.
  (1) IDENTIFICATION — the criterion points to the proof, not the other way around; a `verification` entry gets an optional `id:`, and the criterion ends with a visible `[proof: <id>]`. List-position numbering was dropped, as the task said it should be. Of the two remaining directions, this one won because the criterion is the MOVING side — it gets rewritten and reordered — while the verification entry stays put. A reference kept on the moving side travels with the sentence it belongs to, so reordering the list is a no-op BY CONSTRUCTION, not thanks to anyone's care. The reverse direction would additionally force the proof to enumerate its own criteria — exactly the list that rots when a criterion is deleted. The marker is VISIBLE, not an HTML comment: these files are read with `cat` as often as in a renderer, an HTML comment is invisible in only one of the two, and a link nobody can see is a link nobody maintains.
  (2) MIGRATION — a `criteria_links` policy in config.yaml: `off` / `warn` (default) / `require`, plus a split between errors and warnings. A BROKEN link (a criterion pointing at a nonexistent `id`, a duplicate `id`, an unknown key in the entry) always fails, even under `off` — only someone already using the mechanism could have written one, so failing on it cannot make an old task unclosable. A MISSING link only fails under `require`. Measured effect: 69 active tasks with no links, `check` green, the message states how many there are. Rejected: a requirement keyed to the `created` date — a rule that depends on an invisible field, where two tasks sitting side by side behave differently with no visible reason why.
  (3) EMPTY SAMPLE — a missing `## Acceptance criteria` section and an empty list are judged SEPARATELY and before everything else, with different messages. Without this, a task with no criteria would pass the gate trivially — a guard green on a zero sample.
  (4) RUN RECORD — the distinction written into `docs/worktrail-global-tool.md` §3, next to Law II, with a reusable deciding criterion: if the task files alone are enough to reconstruct something, it is a view (delete it); if it also needs the TIME at which something happened, it is an event record and falls under Law I.
  DONE: `scripts/criteria.mjs` (parser + audit + `applyProofs`), `scripts/check-backlog-criteria.mjs`, `check --criteria` in the dispatcher (runs as part of the full set with no selector), `criteria_links` in config.mjs and in the `init` template, `_template.md` and the example task from `init` SHOW the link instead of describing it, `scripts/tests/criteria-mapping.test.mjs` (19 assertions). 394/394 green.
  ALONG THE WAY, OUT OF SCOPE: the regex replacing the `verification` block in `new-task.mjs` only swallowed `- ` lines, so it left an orphan on a two-line entry; `createTask` now accepts an entry as an object `{id, bash|manual}`. `manual:` was added to the allowed keys — the backlog already uses it (TL-82), and a parser that fails on the project's own data is useless.
  NOTE FOR THE NEXT SESSION: `applyProofs` is a function, not a command — NOTHING calls it yet in the normal flow. Checking off is turned on by `worktrail done` from TL-82; until then a checkbox can still be set by hand and can still lie. The `check --criteria` gate guards the LINK, not the truth of the checkmark.
  This task's own criteria were checked off by `applyProofs`, after a green run of all four `verification` entries — not by hand.
