---
id: TL-212
title: "A task needing a person to vouch is not a task needing a person to do it"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: vouch-park
    bash: "node --test scripts/tests/run-awaiting-vouch.test.mjs"
---

## Goal

A task whose code an agent can write and whose contract ends in a `manual:`
entry is handed to the fleet, worked, and then parked as AWAITING A VOUCH —
not refused, not blocked, and not withheld from the queue in the first place.
`Waiting on you` then shows the thirty seconds that are actually a person's,
instead of the whole task.

## Context

Reported by the project owner on 2026-09-03, reading the panel: ten rows under
a heading that says "work that cannot move until a person decides", when five
of them need no decision at all.

WHAT PUT THEM THERE. On the same day, nine tasks carrying a `manual:` entry
were marked `executor: human` in one pass, on one criterion — an unattended run
can never close them. The effect was right and the meaning was wrong.
`executor:` says WHO MAY BE HANDED the task; it was used to mean who may CLOSE
it. Those are different questions and only the first has a field.

The split, on this backlog today:

  a person must DO it     TL-203 (a history rewrite with every session
                          stopped), TL-102 (a recording; this machine has no
                          asciinema and no TTY), TL-179 (searches in three
                          trademark registers), TL-123 (a vocabulary decision)
  a person must VOUCH     TL-89, TL-55, TL-77, TL-122, TL-159 — every line of
                          code belongs to the fleet, and what is left is
                          pasting a comment, double-clicking a file, pressing
                          TAB in a fresh shell, watching a badge appear, and
                          reading one section

**Why the annotation cannot simply be reverted.** Without this task, a reverted
mark returns the failure it was covering: the loop takes the task, does the
work, `done` refuses because a `manual:` entry needs a person and there is no
terminal, and after the last attempt the task is parked as blocked. The work is
done and the state says it failed. The mark has to stay until the park below
exists.

**What already exists and must be composed, not duplicated.** `done` already
knows the case — it refuses with a `refusalKind` naming it, and `--confirm-manual`
already vouches for every manual entry at once, recording who did. TL-190 made
that refusal reachable as a terminal outcome instead of dead code. What is
missing is the STATE: there is no status meaning "worked, unverified", so the
loop has nowhere to put such a task except the one that means failure.

**Why `--confirm-manual` is not the answer for a fleet.** It records
`agent:claude` as the one who vouched. In an unattended run that is a machine
signing for a human check nobody performed — the exact substitution `done`
exists to prevent.

**The status is a project VALUE, not a literal.** Whatever this backlog calls
it belongs in `config.yaml` beside the other statuses, and
`reason_required_statuses` decides whether entering it needs a sentence. The
code must not name it.

**What the panel then shows.** A row that says a task is worked and waiting for
a named check, with the `manual:` text as the thing to do — not a card
indistinguishable from a question. That is a rendering change on top of
TL-205's work, and it is the point of the whole task: the count under
`Waiting on you` becomes true.

## Pre-flight reading

1. `scripts/done-task.mjs` — the manual refusal, its `refusalKind`, and what
   `--confirm-manual` records.
2. `scripts/run-loop.mjs` — the park, the stuck status, and TL-191's guard on
   writing over an archived status.
3. `scripts/decision-panel.mjs` — what the panel counts, and the header stating
   the two kinds it already distinguishes.
4. `backlog/config.yaml` — `statuses` and `reason_required_statuses`.
5. `backlog/tasks/TL-193-*.md` — the reason written when a needs-person park
   happens; that task and this one must agree on the wording.

## Steps

1. A status for "worked, awaiting a person's check", declared in
   `config.yaml`, and the loop parking there on the manual refusal instead of
   in the stuck status.
2. `next` keeps such a task out of the queue — it is not work any more.
3. The panel renders it as its own kind, carrying the `manual:` text.
4. Revert `executor: human` on the five tasks that only need a vouch, in the
   SAME commit, with the reason recorded; the four that need a person keep it.
5. `scripts/tests/run-awaiting-vouch.test.mjs` over a fixture whose contract is
   one `manual:` entry: the agent's work survives, the status is the new one,
   and nothing is recorded as blocked.

## Decisions

Nothing decided. Open: whether a human vouching later goes through `done`
again or through a command of its own. `done` re-running the whole contract is
the honest default, since the automated entries may have gone stale while the
task sat waiting.
