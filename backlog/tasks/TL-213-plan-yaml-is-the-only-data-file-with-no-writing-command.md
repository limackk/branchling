---
id: TL-213
title: "plan.yaml is the only data file with no writing command"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: in_progress  # pending | in_progress | blocked | done | cancelled
owner: agent:spec
role: spec  # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: plan-writes
    bash: "node --test scripts/tests/plan-write.test.mjs"
---

## Goal

Scheduling a task into a wave is one act performed by the tool, not a hand edit
of `plan.yaml` that may half-happen. `branchling new --wave "<name>"` creates a
task and schedules it in the same write; `branchling plan add | move | remove`
changes the order afterwards.

## Context

Came out of a real half-completion on 2026-09-03. A session created TL-212 and
edited `plan.yaml` in the same shell line; the plan edit failed, the commit ran
anyway, and the task landed in the backlog scheduled nowhere. The immediate
cause was a careless shell line and is nobody's defect but the author's. What
it exposed is not:

**`plan.yaml` is the only data file this tool will not write.** Task files have
`new`, `take`, `done`, `handoff`, `decide` and `history`, and every one of them
records who acted and why. The plan is edited by hand, so a scheduling decision
leaves no trace of its author, and creating-and-scheduling is two steps that
can end in the middle. `branchling plan` reads and reports and stops there.

**What the tool may write, and what it may NOT.** Membership is mechanical: an
id belongs to a wave, waves are ordered, and `check --plan` already validates
the result against `blocked_by`. The RATIONALE is not: every wave in this file
carries a paragraph of argument saying why those tasks belong together and why
the wave stands where it does, and that is a person's reasoning. A command that
generated it would produce prose nobody wrote and everybody would stop reading.
So: the tool edits membership and preserves comments; it never composes them.
A new wave created from the command line REQUIRES a `--why`, written by the
caller, exactly as `reason_required_statuses` demands a sentence for a status.

**Comment preservation is the hard part and the reason this is a day.** The
file is read by `parsePlanYaml`, which returns waves and ids and drops
everything else. Writing it back from that structure would delete every comment
in the file — the plan's entire argument. The writer has to edit the TEXT,
keeping what it does not understand, the way a careful person would.

**What must not change.** The plan stays ADVISORY — `status:` remains the only
truth about what has happened, and nothing here blocks a task. The single hard
rule stays the one `check --plan` enforces: the order must not contradict
`blocked_by`.

**Whether a plan change belongs in `history/` is open.** The log is keyed by
task and holds facts about a task's own life. A scheduling change is a fact
about the ORDER, which is a different subject, and inventing a `__planned__`
event to make it fit may be forcing one thing into another's shape. Decide it
in this task; "no, the git diff of one file is the record" is a legitimate
answer and is what happens today.

## Pre-flight reading

1. `scripts/plan.mjs` — `parsePlanYaml`, `validatePlan`, and the header stating
   why the plan is data and why it is advisory.
2. `scripts/cli.mjs` — how a writing command is registered and how flags fail.
3. `backlog/plan.yaml` — the comments this must preserve; read one wave's
   paragraph and ask whether a program could have written it.
4. `scripts/new-task.mjs` — where `--wave` would compose, and what `new`
   already writes.

## Steps

1. A text-preserving writer for `plan.yaml`: add an id to a wave, move one
   between waves, remove one, create a wave with a `--why`.
2. `new --wave "<name>"` in one act; an unknown wave FAILS and names the ones
   that exist, rather than creating a wave by typo.
3. Refuse a change that `validatePlan` would reject, BEFORE writing.
4. Decide the history question and record the answer in Decisions.
5. `scripts/tests/plan-write.test.mjs` over a fixture with comments in every
   position — above a wave, beside an id, at the end of the file — asserting
   that they survive a write.

## Decisions

Nothing decided. Note that `--why` on a new wave is the one place this command
demands prose, and it should be refused when empty for the same reason a status
change is.
