---
id: TL-277
title: "Two hands pass one task back and forth because neither may cross the test boundary"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: boundary-has-an-exit
    bash: "node --test scripts/tests/pipeline-deadlock.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A task cannot become unfinishable because each hand's charter forbids the
one file the other needs changed. TL-151 crossed the spec/dev boundary
three times in eleven hours and is still open, with every hand correct at
every step.

## Context

Measured 2026-09-04 22:35 to 2026-09-05 08:00, four agent runs on one task.

TL-151 asks for a `resume` command. What happened:

1. `spec` wrote `scripts/tests/resume-briefing.test.mjs`, red, and handed
   to `dev`. Correct.
2. `dev` wrote `scripts/resume-task.mjs`, the CLI entry and the `resume`
   envelope kind. Its own test went 10 of 10 green. The SUITE did not:
   `scripts/tests/json-envelope.test.mjs` asserts every declared envelope
   kind has a row in its `READING` or `WRITING` table, and declaring the
   kind is what the spec hand's test requires. One line in a test file
   closes it — and the dev charter forbids touching `scripts/tests/`.
   Handed back to `spec`. Correct.
3. `spec` filed TL-273 for the row, added it, and found the next layer:
   two more assertions in the same file. Handed back to `dev`. Correct.
4. The suite stands at 1885 pass, 2 fail, and the task is `pending` for
   `dev` again.

Nobody weakened anybody's proof and nobody did the wrong work. The rule
that produced this — `spec` owns `scripts/tests/`, `dev` owns everything
else — is the rule that makes the split worth having, because it is what
stops a hand satisfying a test by editing it.

**The defect is that the boundary has no exit.** A change whose correct
implementation requires an edit on BOTH sides has no hand that may make it,
and the loop's only move is to pass the task across again. Each crossing
costs a full agent run — the four here total 5624 seconds — and the tool
reports nothing unusual: `run` says `held elsewhere`, which is TL-271, and
the plan simply does not advance.

**Three things the tool could do and does none of.** It could count the
crossings and refuse a third, naming the deadlock. It could let the `spec`
hand pre-declare the registration rows a new command will need, so the
boundary is crossed once, deliberately, at design time. It could define a
narrow shared surface — a registration table is not a proof — that either
hand may edit, which is a decision about what `scripts/tests/` actually
contains: `json-envelope.test.mjs`'s `READING` table is a REGISTRY that
happens to live in a test file.

**Not TL-271.** That is the loop failing to dispatch after a handoff, and
would have made these four runs one. It would have made this cheaper and
not made it terminate.

## Steps

1. Count handoffs per task in the run and report a task that has crossed
   the same boundary twice as a deadlock, by name, with both roles' reasons.
2. Decide the substantive question: is a registration table a proof? If it
   is not, name the files or the regions either hand may edit, and say so in
   the role briefs (TL-264). Record with `branchling decide`.
3. Consider a `handoff --with <files>` that names what the receiving hand is
   permitted to change, so the exception is on the record rather than in a
   charter.

## Acceptance criteria

- [ ] A task handed across the same boundary twice is reported as a
      deadlock rather than as held elsewhere, proven by a test that fails
      against today's loop. [proof: boundary-has-an-exit]
- [ ] A normal one-way handoff is unaffected. [proof: suite-green]
- [ ] Whether a registration table counts as a proof is a `__decision__`
      event in `backlog/history/TL-277.jsonl`.
