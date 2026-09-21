---
id: TL-156
title: "doctor reports configured values that no task carries"
type: task
labels: []
board: main
epic: "Data integrity"
priority: P2
status: done
owner: agent:claude
estimate: 3h
confidence: high
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node --test scripts/tests/config-vocabulary.test.mjs"
  - bash: "node scripts/doctor.mjs | grep -i 'cancelled'   # this repo: declared, carried by 0 of 155 tasks"
---

## Goal

`auditVocabulary()` answers one direction of the config↔tree question: a value in
the tree that no vocabulary allows. The other direction is unasked — a value
declared in `config.yaml` that **no task carries**. Report it in `doctor`.

## Context

TL-56 closed the asymmetry between the write path and the read path for values
the configuration does not know. The mirror asymmetry is still open, and it is
the quieter one: an entry sits in `config.yaml`, appears in every editor
dropdown, gets a colour, is counted by dashboards — and means nothing, because
nothing uses it. Nothing is ever red, so nobody looks.

**Measured 2026-09-02, and the measurement is the reason this is a REPORT and not
a guard.** The same query produces two opposite verdicts:

| repo | value | uses | verdict |
|---|---|---|---|
| this one | `status: cancelled` | 0 of 155 | **fine** — a terminal status nobody has needed yet |
| `<origin>` | `status: on_queue` | 0 of 1397 | **stale** — a workflow status configured and never adopted |

A gate that failed on zero uses would nag this repository for not having
cancelled anything. Only a person can tell "not needed yet" from "configured and
forgotten", so the tool's job is to put the number in front of them, next to the
two edits that resolve it: use the value, or drop it from `config.yaml`.

**Where the cost lands.** `<origin>` declares seven statuses; its
`backlog/README.md` §4, the section anyone reads for what a status means,
diagrams five. The two it omits are `on_hold` (4 tasks) and `on_queue` (0). An
agent closing an epic there read §4, concluded the vocabulary had no state for
"waiting on something outside the code that is not another task", told the
founder so, and proposed inventing a milestone task with every post-launch item
hanging off it by `blocked_by` — a convention change to work around `on_hold`,
which already existed and was already in use. The documentation drift is that
project's to fix (`origin#BL-1471`). What belongs here is the number that
would have made the drift visible from the tool: `on_queue` carried by nobody is
the loose thread that leads to "so what else does this config claim?".

## Pre-flight reading

1. `scripts/task-fields.mjs` — `auditVocabulary()`. It already builds a `counts`
   Map per spec while looking for divergent values; the unused direction is the
   same traversal read the other way. **Do not add a second traversal** — the
   file's own rule is "one measurement, not a second set of rules", and a report
   with its own copy would eventually disagree with the guard.
2. `scripts/doctor.mjs` — how findings are shaped and where the repair command
   goes next to each item. Doctor fixes nothing; keep it that way.
3. `scripts/check-backlog-vocabulary.mjs` — the header states why THAT direction
   fails rather than warns. This one is the opposite case and the contrast is
   worth stating in the new code, not just here.

## Steps

1. Extend `auditVocabulary()` to return, per closed vocabulary, the declared
   values with a count of zero — alongside what it already returns. Same
   traversal, same `counts` Map.
2. Report them in `doctor` as a **diagnosis, not a failure**: name the field, the
   value, the size of the tree it was measured against, and both repairs ("use
   it, or remove it from `config.yaml`").
3. Say the tree size out loud. "0 uses" out of 12 tasks is noise; out of 1397 it
   is a finding. A count without its denominator invites the wrong conclusion.
4. Leave `check-backlog-vocabulary.mjs` alone — it is a gate and this is not
   gateable, for the reason in the table above.
5. Tests in `scripts/tests/config-vocabulary.test.mjs`: a value used zero times
   is reported; a value used once is not; an empty tree reports nothing at all
   (otherwise a fresh project is told every value it configured is dead).

## Acceptance criteria

- [ ] `auditVocabulary()` returns unused declared values without a second traversal
- [ ] `doctor` prints them with the tree size and both repairs; exit code unchanged
- [ ] `check-backlog-vocabulary.mjs` behaviour unchanged (still a gate, still one direction)
- [ ] Tests cover: unused reported, used not reported, empty tree silent
- [ ] Running `doctor` in this repo names `status: cancelled` (0 of 155)

## Verification

```bash
node --test scripts/tests/config-vocabulary.test.mjs
node scripts/doctor.mjs            # expect: status `cancelled` declared, carried by 0 of 155 tasks
```

## Notes

**What this deliberately does not do.** It does not check that a project's own
documentation describes its configured vocabulary. worktrail has no notion of a
project's `README.md` and should not acquire one — that is a file it neither owns
nor manages, and the parity between config and prose belongs to the repository
holding both. The number reported here is the part the tool can actually know.

**Naming.** "dead vocabulary" is the tempting phrase and it is wrong: `cancelled`
in this repo is not dead, it is unused. The report should say what it measured
(carried by no task) rather than what it concluded.

## Log

- 2026-09-02 created — agent:claude — from closing the "Ochrona danych lokalnych" epic <!-- language-guard: allow — another repository's epic name, a fact rather than prose --> in the origin repository; measured in both repos before filing, and the two opposite verdicts are what turned it from a guard into a report
