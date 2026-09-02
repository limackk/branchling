---
id: TL-68
title: "The log says done, the frontmatter says pending — nothing catches it"
type: bug
labels: [pre-launch]
board: main
epic: "Data integrity"
priority: P2
status: done
owner: agent:claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - id: suite
    bash: "node --test scripts/tests/log-status-agreement.test.mjs"
  - id: wired
    bash: "node scripts/cli.mjs check"
  - id: recorded
    bash: "grep -q 'step 5 settled' backlog/tasks/TL-68-*.md && echo 'the error/warning choice is recorded with its reason — OK'"
  - id: doctor
    bash: "node scripts/cli.mjs doctor --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);const row=r.checks.find(c=>c.id==='log-status');if(!row){console.error('no log-status row in doctor');process.exit(1)}console.log('doctor knows about this drift — OK')})\""
---

## Goal

Catch a task whose `## Log` says one thing and whose `status:` field says
another — because today this drift is not seen by any gate.

## Context

Encountered 2026-08-31 during our own work.
[TL-52](TL-52-kolor-i-spojne-komunikaty-cli-w-jednym-module-ui-mjs.md) had
five `done` entries in its log, committed code, and green tests — while its
field read `status: pending`. Because of this it sat in `INDEX.yaml` as
open and fell out of the archive, meaning **the views lied about the state
of the project**.

The mechanism behind the mistake is trivial and repeatable: appending to the
log and changing the field are two separate edits to the same file. When one
of them fails — because a call errored, because a substitution didn't match
the pattern, because someone added a note and forgot to flip the status —
the file is left internally inconsistent and **nothing reports it**. `check`
looks for number collisions, boards, and references; none of those three
looks inside a file to compare it against itself.

**Why this deserves a guard rather than just care.** This backlog exists to
answer the question "what is done". A task whose status contradicts its own
log answers that wrong, looks normal while doing so, and gives no one a
reason to open it. This is exactly the class this project's other gates were
built for — a silent state that looks like it's working.

The log format is declared in the template: `YYYY-MM-DD status — who —
note`. The last entry matching that shape carries the state the task has
reached.

**What this guard MUST NOT do.** It must not fix the file. A human resolves
the contradiction, because either side can be the true one: the log may be
ahead of the field (work finished, status not yet updated), or the field may
be ahead of the log (status flipped in the viewer, note not yet added). An
automaton picking one side would turn a detected contradiction into a silent
decision.

## Pre-flight reading

1. `backlog/_template.md` — the declared log-entry format.
2. `scripts/check-backlog-refs.mjs` — the closest guard in shape (reads the
   tree, lists violations, fails).
3. `scripts/doctor.mjs` — how a row is added to the diagnosis; `doctor` calls
   guards, it does not reimplement them.
4. `scripts/task-fields.mjs` — `splitFrontmatter`, `extractMeta`.

## Steps

1. A function that reads the LAST log entry matching the declared shape and
   returns its status; no entries is not a violation, only an absence of
   data.
2. A guard comparing that status against the `status:` field. A violation is
   a difference, not an absence.
3. The message names the file, both values, and the date of the last entry —
   so it can be resolved without opening the file.
4. Wire it into `worktrail check` as a fourth guard, and add a `log-status`
   row to `doctor`.
5. Decide whether this should be an error or a warning. Argument for a
   warning: a log entry is sometimes appended after the status change, and
   the state is briefly contradictory during normal work. Argument for an
   error: `check` runs before a commit, not mid-edit. Record the choice and
   the reason.
6. Test with a positive control in both directions: a consistent file
   passes, a file with a `done` log entry and a `pending` field FAILS.
   Without this second half the guard would be green across today's entire
   tree and would prove nothing.

## Acceptance criteria

- [x] Drift between the last log entry and the `status:` field is detected. [proof: suite]
- [x] The message states the file, both values, and the entry date. [proof: suite]
- [x] The guard fixes NOTHING. [proof: suite]
- [x] A task with no log entries is not a violation. [proof: suite]
- [x] Wired into `check` and visible in `doctor`. [proof: doctor]
- [x] The test has a positive control: a fixture with drift MUST fail. [proof: suite]
- [x] The error/warning choice is recorded in `## Log` with a reason. [proof: recorded]

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — encountered during our own work: TL-52
  had five `done` entries in its log and `status: pending` in its field, sat
  in the INDEX as open, and no gate saw it
- 2026-09-02 in_progress — agent:claude — step 5 settled: NEITHER a plain error
  nor a plain warning, because the two directions of drift are not the same
  defect. A log naming an ARCHIVED status while the field is open is TL-52
  exactly — finished work counted as open, the index misreporting the project
  while looking normal — so it FAILS. A log merely BEHIND its field is stale
  prose, and since TL-105 it is the normal end state of every legacy task:
  nothing writes `## Log` any more, so `done` moves the field and no closing
  line will ever be appended. Measured before deciding: 27 of this repository's
  88 status-bearing logs are behind their field, and ZERO are ahead. An error in
  both directions would have left `check` permanently red with two ways out —
  inventing entries in somebody else's append-only notes, or switching the guard
  off — and a warning in both would report the one defect it exists for in the
  same voice as the noise around it
