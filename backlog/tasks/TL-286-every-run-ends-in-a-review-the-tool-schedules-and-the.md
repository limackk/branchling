---
id: TL-286
title: "Every run ends in a review the tool schedules, and the review is a guide the tool prints"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: review-is-seeded
    bash: "node --test scripts/tests/run-review.test.mjs"
  - id: guide-does-not-drift
    bash: "node --test scripts/tests/instructions-run-review.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

What a person did by hand after every wave on 2026-09-04 and 05 — read
the report against the tree, read every hand's friction section, count
what recurs, file what is new with a measurement, fold evidence into what
is already filed, and record what WORKED — is a step the loop schedules
for itself and a guide the tool prints. The tool gets better between runs
because the review runs, not because somebody remembered to do it.

## Context

**What the review actually consisted of**, reconstructed from eleven waves
and 32 agent logs, so the guide is written from practice rather than
imagined:

1. Report against tree. `run` said `1 blocked`; the tree said
   `in_progress` with a live lock (TL-282). `run` said `closed-elsewhere`;
   the hand it named was the run's own (TL-200). The report is a claim and
   the tree is the fact, and the first thing a review does is diff them.
2. Every friction section, read in full, then COUNTED across runs. Read
   singly, 17 sections are 17 anecdotes. Counted, 11 of 17 complain of the
   same thing (TL-275, TL-276) and two hands that never saw each other
   report one defect in the same words (TL-261). The count is what makes
   a finding a task rather than an opinion.
3. Classify each item four ways, because they go to four places: a defect
   in the tool (a task, with the measurement); a defect in the charter
   (fixed in the charter, which is TL-264's subject); the environment (a
   locked signing agent, a vendor's quota — reported, never filed); and
   not a defect at all (a guard doing its job, noted so nobody files it
   twice).
4. Evidence for what is already filed. Most findings are not new: the
   ninth occurrence of TL-243 is worth one line in TL-243, not a tenth
   task. The review reads the open backlog before it writes to it.
5. What worked. TL-271's fix was confirmed by TL-91 closing in one run
   where TL-151 had taken four. A fix that the next wave confirms is a
   finding too, and the only one that closes the loop; a review that
   records only failures cannot tell a tool that is improving from one
   that is not.
6. The reviewer's own regressions. TL-281 was introduced by TL-271 and
   found by the run after it. The review asks "what did the last review's
   fixes break" before it asks anything else.

**Why a document alone will not do it.** Every rule that has lived only in
prose here has either drifted (TL-274) or been done by whoever happened to
remember (the whole of the above). The four laws answer the shape: the
mechanical half is a COMMAND, composable and `--json`; the judgement half
is a guide the tool PRINTS, so it cannot drift from the tool it describes
(the `CONTEXT_RULE` pattern — one source, and a test that fails if the copy
falls behind); and the scheduling is the machinery that already exists —
`docs-drift --seed-tasks` turns a finding into a task for a role, and
`roles:` declares `review`, which no task has ever asked for.

**Three pieces, in order of leverage.**

The command. `branchling review --run <log-dir>` (or `run --review` at the
end of a run) prints, for one run: each task's outcome as the report said
it and as the tree now says it, side by side; the friction section of
every leg (TL-269 harvests it), grouped by task; tests red now that were
green at the run's merge base; tasks created during the run; and a
recurrence tally against the friction of every earlier run in the same
state directory. Nothing here needs judgement, and all of it was done with
`awk` and `python3` by hand this week.

The guide. `branchling instructions run-review`: the six steps above,
written for a reader with none of this conversation, naming the command
and what to do with each block of its output, with a test that fails when
a flag or command it names does not exist. It is also the `review` role's
brief, which is TL-264's answer for one role.

The scheduling. A run that ends seeds one review task for the `review`
role, carrying the log directory in its `## Context` and `review --run
<dir>` in its `verification:` — the exact shape `docs-drift --seed-tasks`
already writes. A fleet serving `review` then picks it up; one that does
not reports it under "waiting for a role this run does not serve", which
is the honest state. The wave after this one is reviewed by the loop that
ran it.

**What learning over time means here, concretely.** Not a model that
remembers: a backlog that accumulates measurements, a guide that is
revised when a review finds it wrong, and a tally that shows whether the
same complaint is falling or rising across runs. TL-243 was filed on its
first occurrence and had twenty-one by evening; a tally would have shown
that curve on the second day without anybody counting.

**What this is not.** Not a plugin, not a hook the tool calls, not a place
for the tool to grade itself. The review's output is text and tasks; a
person or an agent reads it; the four laws hold.

## Steps

1. Decide, with `branchling ask`, whether the review is seeded at the end
   of every `run` or only when asked (`run --review`). Seeding every time
   fills the queue with review tasks nobody serves; asking every time is
   the habit this task exists to replace. The recommendation is to seed
   when the run served at least one role — a fleet — and to print the
   command otherwise.
2. `branchling review --run <dir>`, with `--json`, built on TL-269's
   harvest and on the run's report file.
3. `instructions run-review`, with the drift test.
4. The seeding, reusing `docs-drift --seed-tasks`'s writer.
5. Run one wave with a `review` hand served and read what it filed.

## Acceptance criteria

- [ ] A run serving a role ends with one task for the `review` role,
      naming the run's log directory, proven by a test that fails against
      today's loop. [proof: review-is-seeded]
- [ ] `branchling review --run <dir>` prints report-versus-tree, friction
      by task, and a recurrence tally, and every command the guide names
      exists. [proof: guide-does-not-drift]
- [ ] Nothing changes for a run that serves no role. [proof: suite-green]
- [ ] Whether every run seeds a review is a `__decision__` event in
      `backlog/history/TL-286.jsonl`.
