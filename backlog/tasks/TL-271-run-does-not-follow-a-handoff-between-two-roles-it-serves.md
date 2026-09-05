---
id: TL-271
title: "run does not follow a handoff between two roles it serves"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: handoff-followed
    bash: "node --test scripts/tests/run-follows-handoff.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A run that serves both `spec` and `dev` carries a task from one to the
other. When the hand serving one role hands the task to a role the same run
serves, the run's next move is to give it to that hand — not to retry the
first, and not to report the task as held by nobody and stop the plan.

## Context

Measured on 2026-09-04, 22:35–23:00, wave 11, one `run` with
`--agent-for docs=… --agent-for spec=… --agent-for dev=… --actor agent:fleet`:

    ! TL-151  held-elsewhere  2 attempts  1040s
        TL-151 is held by nobody, not by agent:fleet — this run's claim on it is gone
    stopped: plan wave 11 … is not finished — 1 of 1 task(s) in it are
    still open and none was free to take

What happened, from the agent log and `backlog/history/TL-151.jsonl`:

1. Attempt 1, the `spec` hand: wrote the failing test, committed it, ran
   `handoff TL-151 --to-role dev`. History at 20:51:10: `status
   in_progress → pending`, `owner agent:fleet → ""`, `role spec → dev`.
   The task is now exactly what the run's `dev` hand is for.
2. The loop ran `done`, which refused — the test is red by design at this
   stage. It counted that as a failed attempt and started attempt 2 **with
   the `spec` command again**, feeding it the refusal as "the previous
   attempt did not close this task".
3. The spec hand, on its second run, wrote in its friction log: "At the
   spec stage the refusal *is* the deliverable. The retry framing invited
   me to treat a correct outcome as a failure and rewrite work that was
   already sound." It committed the handoff record and stopped.
4. `done` refused again. Attempts exhausted, the loop re-read the file,
   found `owner: ""` and `role: dev`, and reported the task as held
   elsewhere — by nobody.
5. The plan then stopped at wave 11, "none was free to take", with a
   `pending` task asking for `dev` and a `dev` hand idle.

The pipeline worked in wave 8 only because each role was a SEPARATE `run`,
launched in sequence by a person. Nobody is told that. `run --help` says
"one queue, several hands" and describes `--agent-for` as serving roles
side by side, which is what was attempted here.

**Three things the loop does not know, and one it does not tell.**

The attempt counter is per task, not per (task, role). A handoff is not a
failed attempt; it is that role's SUCCESS on this task, and the count for
the next role should start at zero.

A change of `role:` under the loop's feet is a routing event, not a loss
of the claim. The loop already re-reads the file after every attempt — the
right reaction to `role` changing to one it serves is to dispatch, not to
report.

`done` refusing after a handoff is expected, and running it at all is
wasted time: the task was given back to the queue by the hand, and the
loop's `done` then ran an 80-second suite to learn what the handoff had
already said.

And the hand is never told who it is. The run claimed the task as
`agent:fleet`; the spec hand, told by its charter to act as `agent:spec`,
was refused by `handoff` ("owner: agent:fleet — it is theirs to hand on")
and had to read the history file to learn the actor. `run` substitutes
`{task_file}` and `{id}` into the command and exports nothing else — not
the actor, not the role it is serving. Both are known to the loop and
cost nothing to pass.

**Not TL-231.** That task is `handoff` parking an in-progress task as
`blocked`; here the handoff correctly left the task `pending` and the
LOOP failed to pick it up. Not TL-227 either, which put the role in the
history entry and is closed.

## Steps

1. After each attempt, if the task's `role` changed to one this run serves
   and its owner is empty, treat the attempt as `handed-on` (a new outcome,
   reported by name), skip `done`, and dispatch the task to that role's
   command with a fresh attempt count.
2. Export `BRANCHLING_ACTOR` and `BRANCHLING_ROLE` (names per
   `scripts/product.mjs`, not literals) into the agent's environment, and
   say so in `run --help`, so a hand can act under the actor that holds the
   task.
3. Decide what happens when the role changes to one this run does NOT
   serve: the current "held elsewhere" is defensible there. Record with
   `branchling decide`.
4. Say in `run --help` and in the autonomous-loop guide (TL-263) that a
   pipeline of roles runs in ONE `run`, and that a handoff between served
   roles is followed.

## Acceptance criteria

- [x] A fake `spec` agent that hands off to `dev` in a run serving both is
      followed by the `dev` command on the same task, with attempt 1,
      proven by a test that fails against today's loop.
      [proof: handoff-followed]
- [x] The report names the handoff as its own outcome, not as a failed
      attempt and not as held elsewhere. [proof: handoff-followed]
- [x] The agent's environment carries the actor and the role.
      [proof: handoff-followed]
- [x] A single-role run is unchanged. [proof: suite-green]
