---
id: TL-105
title: "The reason for a change travels with the write — today ## Log has zero adoption"
type: task
labels: [pre-launch]
board: main
epic: "History and attribution"
priority: P1
status: done
owner: agent:claude
estimate: 4h
confidence: medium
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - id: reason-contract
    bash: "node --test scripts/tests/change-reason.test.mjs"
  - id: guard-wired
    bash: "node scripts/cli.mjs check | grep -q 'reasons:'"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: log-section-gone
    bash: "grep -q '## Log' _template.md && { echo 'template still teaches ## Log'; exit 1; }; grep -rq '## Log' .claude/skills/backlog-workflow/SKILL.md && { echo 'skill still teaches ## Log'; exit 1; }; echo 'template and skill do not teach ## Log — OK'"
---

## Goal

The reason for a change is recorded together with the change, in a structure
that can be queried — not in a prose section that nobody fills in. After this
task, the question "why was this task cancelled" has an answer in the data,
not in the memory of a person who no longer remembers.

## Context

`history/*.jsonl` records WHAT changed: `field`, `from`, `to`, `actor`,
`source`, `ts`. There is no place for WHY. Justifications were supposed to
live in `## Log` (the template declares the format `YYYY-MM-DD status — who —
note`, the skill requires a line to be appended on every status change).

> **CORRECTION (2026-09-01, made while carrying out this task).** The
> measurement below IS WRONG and was re-measured before starting work. The
> real numbers on the same tree: **8 of 117** tasks without a dated line (not
> 67 of 87), **290** lines (not 24), spread across four days (Aug 29: 30, Aug
> 30: 51, Aug 31: 145, Sep 1: 64) — so not "from a single session"; **43 of
> 51** closed tasks have a line, not 0 of 44. In the fully declared format
> there are 181 lines. Suspected cause of the original measurement: the lines
> use the word `created`, which is NOT IN the `statuses` vocabulary, so the
> parser that keys off the configuration drops them.
>
> **Adoption of `## Log` is ~93%, not zero.** The owner was informed of this
> before starting and nonetheless chose the FULL SCOPE, including removing
> `## Log`. Carried out per that decision. The argument that therefore does
> NOT hold: "nobody fills it in." The argument that stands and is sufficient
> on its own: two places for the same thing, one of which is unstructured
> prose — "why was this task cancelled" still had no answer in the data,
> because 290 lines of prose cannot be queried.

**Measurement on our own tree (2026-09-01) — OUTDATED, see correction above:**

```
`status` field changes in history:              4
with any reason field:                          0   (schema doesn't have one)

tasks:                                         87
without a single dated line in `## Log`:       67
dated `## Log` lines total:                    24   ← all from Aug 31–Sep 1,
                                                     i.e. from one session
closed tasks with a line in `## Log`:       0 of 44
```

Zero of forty-four. The convention described in the template, repeated in the
skill, and required by the closing procedure **was never used even once**
throughout the project's entire lifetime — including by the agent that wrote
this documentation.

**Diagnosis: this is not carelessness, it is a design defect.** In the same
repository, in the same period, `actor` has one-hundred-percent presence —
because `history-record.mjs` REJECTS a write without a namespaced actor. The
difference between `actor` and `## Log` does not lie in the discipline of the
people writing, only in the fact that one is required at the moment of
writing, and the other is a request in documentation. This is the same lesson
given by the acceptance-criteria measurement in TL-86 (12 of 44 tasks with
dead checkboxes): **a request for honesty loses to a requirement enforced at
write time.**

The consequence is exactly the gap this tool was built for. The backlog is
meant to be a memory that outlives an agent's session and context compaction
— and compaction destroys the reasoning behind decisions first. If the "why"
layer does not exist in our data, the backlog stores exactly the same thing
as `git log` and loses its reason for existing.

**Three decisions to make:**

1. **Where the reason lives.** Recommendation: a field in the history record
   (structured, queryable, alongside the event), and `## Log` either
   disappears from the template or is GENERATED from history. Two independent
   places for the same thing already lost once — see the numbers above. If
   you choose otherwise, record why.
2. **When the reason is REQUIRED.** Not on every field change — a requirement
   on fixing a typo in a title would produce 87 "update" entries and kill the
   signal within a week. Recommendation: required on status transitions that
   carry a decision — `→ blocked`, `→ cancelled`, `→ done` with unmet
   verification, and on every use of the override (`--force`). Everything
   else optional. Write out a closed list and justify it, instead of
   requiring it everywhere.
3. **Change the schema before publication, not after.** `history/*.jsonl` is
   a PERMANENT format, versioned in git. Adding a field after publication is a
   migration of other people's data; hence `pre-launch` despite there being no
   visible symptom.

**Deliberately OUT of scope:** the rot of `## Context` (a section written when
a task is created can be contradicted by what actually happened, and nothing
signals that). That is a different problem — it concerns prose written up
front, not an event recorded on the fly. If it turns out to matter along the
way, open a separate task, do not append it here.

**Coupling, not a block:** TL-82 (`worktrail done`) will write history
records. If it lands first, it will do so in the old schema and those entries
will need migrating — the cost of a handful of records, so I am deliberately
NOT blocking the P0 chain. If you do TL-82 before this task, reserve the field
in the record.

A separate, already-existing problem: TL-68 catches the drift in the other
direction — `## Log` claims `done`, while the frontmatter says `pending`. Do
not duplicate; if `## Log` disappears, check whether TL-68 loses its premise,
and record that in its log.

## Pre-flight reading

1. `scripts/history-record.mjs` — the shape of the record and the place where
   an actor without a namespace is REJECTED. This is the pattern to repeat
   for the reason.
2. `scripts/history.mjs` — reconciliation of changes made outside the tool;
   there the reason will often not be known and this must be representable.
3. `docs/backlog-field-editing-history.md` — decisions about attribution; the
   actor namespace stays untouched.
4. `_template.md` — the `## Log` section and its declared format.
5. `backlog/tasks/TL-86-*.md` — the same class of bug measured on acceptance
   criteria.

## Steps

1. Settle points 1–2 from the context; record the justifications in this
   task.
2. Extend the history record with a reason field; an unknown key still fails.
   A change detected by reconciliation (`source: external`) must represent
   "reason unknown" EXPLICITLY, not as an empty string pretending there was
   no need.
3. Enforce the reason on a closed list of transitions. The refusal message
   says which transition requires it and why — not just "field missing."
4. Callable entry point: a flag on writing commands (law IV), consistent with
   `--append-` from TL-83.
5. Viewer: a reason field on status changes, shown on the history timeline.
6. `worktrail check --reasons` — transitions with a required reason that lack
   one. For the 87 existing tasks this will be a historical report:
   **decide whether it warns or fails**, so that enabling it does not block
   the whole tree at once.
7. `## Log`: remove from the template or generate it from history. Update the
   skill and `instructions` (TL-74) so they do not teach a convention that no
   longer exists.
8. `scripts/tests/change-reason.test.mjs`: a transition requiring a reason
   without one FAILS; with a reason it is recorded in the record; an external
   change records "reason unknown" explicitly; a change outside the list does
   not require a reason; the reason is queryable. Positive control: a fixture
   with non-default statuses — a test based on the literals `done`/`blocked`
   must fail.

## Acceptance criteria

- [x] The reason is a field of the history record, queryable, not prose in a file. [proof: reason-contract]
- [x] The list of transitions requiring a reason is closed, recorded, and justified — as the `reason_required_statuses` key, not a literal in the code. [proof: reason-contract]
- [x] Missing a reason on such a transition fails, with a message saying which transition and why. [proof: reason-contract]
- [x] "Reason unknown" on an external change is represented explicitly, not as an empty string. [proof: reason-contract]
- [x] `check --reasons` reports gaps, in a run WITHOUT a selector; the mode (reports, does not fail) is decided and justified with respect to the existing tree. [proof: guard-wired]
- [x] `## Log` does not exist in the template nor in what `done` writes — sections in old tasks remain as historical prose. [proof: log-section-gone]
- [x] The template and the skill do not teach a convention that no longer exists. [proof: log-section-gone]
- [x] The test passes on a NON-DEFAULT status vocabulary. [proof: reason-contract]
- [x] Full suite green. [proof: suite-green]

## Notes

**What was deliberately NOT done from step 7.** `worktrail instructions`
(TL-74) does not yet exist, so there is nothing to update — the criterion
talks about the template and the skill because today only they teach
anything. When TL-74 is created, it must not recreate `## Log`; recorded in
its log.

**Coupling with TL-68** (`## Log` says `done`, frontmatter says `pending`).
This task does not remove the section from existing files, so TL-68's premise
still stands for the tree that already exists — but new tasks have no way to
produce this drift, because they have no section. TL-68's scope shrinks to
historical data.

## Log

**Repair note (TL-137, 2026-09-02).** This file was found with its content
duplicated: a well-formed, finished copy (`status: done`, all acceptance boxes
checked, no `## Log` section) followed immediately by a second, malformed copy
— missing its own opening `---` and the start of its `title:` — carrying an
EARLIER state (`status: in_progress`, unchecked boxes) but also the genuine
`## Log` entries below, written as the task's three decisions were made. The
duplication is an editing artifact, not a deliberate second version. Repaired
by keeping the finished copy above and this `## Log` section, taken verbatim
from the orphaned copy — per CLAUDE.md, an existing `## Log` section is kept,
not discarded, even though new tasks no longer carry one.

- 2026-09-01 pending — agent:claude — created after the measurement: 0 of 44 closed tasks have a line in `## Log`, and all 24 existing lines come from a single session. `actor` in the same repo has 100% presence, because it is required at write time. The "why" layer does not exist in the data, which strips the backlog of its reason to exist relative to `git log`.
- 2026-09-01 in_progress — agent:claude — **THE TASK'S PREMISE WAS DISPROVEN BEFORE STARTING.** Re-measured: 8/117 tasks without a dated line, 290 lines across four days, 43/51 closed with a line. The owner was informed, and chose the FULL SCOPE regardless — and that is the decision that was carried out. Recording the refutation in `## Context`, because a task that stays in the tree with a false measurement keeps teaching that measurement.
- 2026-09-01 in_progress — agent:claude — **DECISION 1 (where the reason lives): a `reason` field in the history record; `## Log` disappears from the template, from the skill, from CLAUDE.md, and from what `done` writes.** Sections in EXISTING tasks stay untouched — they carry sentences nobody will reconstruct, and deleting someone else's writing for the sake of tidiness costs more than the tidiness is worth. Rejected "generating `## Log` from history": that would be a third representation of the same thing, not fewer than two.
- 2026-09-01 in_progress — agent:claude — **DECISION 2 (when it's required): the list is the `reason_required_statuses` CONFIGURATION KEY, not a literal in the code.** This is not decoration — `blocked`/`cancelled` are THIS project's vocabulary (law 3), and a list baked into the script would impose it on someone else's backlog. A missing key falls back to `archived_statuses`: leaving the queue is a decision, and a default `[]` would make the mechanism opt-in, which would repeat exactly the mode in which the convention has no enforcement. This project sets `[blocked, cancelled]`. The requirement applies ONLY to status transitions: a reason on every field change would produce "update" on every typo fix in a title and would kill the signal within a week.
- 2026-09-01 in_progress — agent:claude — **SECOND SENTINEL, `proven`.** The default closing status is reached through `worktrail done`, which RUNS verification and refuses on the first failure — the reason for this transition is the run itself, recorded alongside as `__verified__` entries. Requiring a sentence here would teach people to type "done" into the reason field, producing noise in a field that is meant to have none. To EVERY OTHER archival status (`cancelled`) no run leads, and there a reason is required. Both sentinels (`unknown`, `proven`) are RESERVED at write time: `--reason unknown` fails as a usage error, because a machine's answer dressed up as someone's sentence is worse than no answer.
- 2026-09-01 in_progress — agent:claude — **DECISION 3 (`check --reasons`): REPORTS, does not fail, and this is not softness.** Every gap it can find is in the PAST and nobody will fill it in today. A guard that fails leaves two ways out — invent reasons on someone else's behalf, or turn the guard off — and both are worse than the gap. Enforcement sits AT WRITE TIME, where the person who knows the answer is still around. The report separates THREE kinds of absence (`unknown` = a change that was observed, not made; missing field = an entry from before the mechanism existed, the log is append-only; a genuine gap = someone skipped the question), because summed together they would read as "everyone skips it," and only the third is anyone's fault. On this tree: 4 of 4 are entries from before the field existed.
- 2026-09-01 in_progress — agent:claude — the reason is copied onto EVERY entry of a single act (one act moves the status and `updated` at once), because an answer readable only from whichever entry happens to come first depends on how the log is read. The field is on EVERY entry, including where it is not required: a field present on only some rows would make "not given" and "not needed" look identical on disk.
- 2026-09-01 in_progress — agent:claude — entry on three write routes: `done --reason`, `history --reason` (one reason per run — that is the granularity this route actually has), and the `reason` field in `POST /api/field`. The viewer asks INLINE in the task panel, not in a modal: a dimming overlay covers up the very thing that needs explaining. The server refuses independently of the browser, so the prompt in the UI is a convenience, not the enforcement. The reason is shown on the history timeline as a SECOND LINE, not a tooltip — a "why" that has to be hovered over is a "why" nobody reads.
- 2026-09-01 in_progress — agent:claude — `scripts/tests/change-reason.test.mjs`, 17 assertions. The whole file stands on a fixture with the `open/parked/shipped/dropped` vocabulary — the positive control from step 8: a test written against the literals `blocked`/`cancelled` would pass against a rule baked into the code, i.e. against exactly the defect this decision avoids. Assertions on refusals, not the happy path: the task file untouched and zero history after a refusal, because a refusal after the write would leave the task changed and the history saying "no." 448/448 green.
