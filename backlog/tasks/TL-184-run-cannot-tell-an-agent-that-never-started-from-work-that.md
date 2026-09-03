---
id: TL-184
title: "run cannot tell an agent that never started from work that failed"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
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
  - id: agent-never-started
    bash: "node --test scripts/tests/run-agent-launch.test.mjs"
---

## Goal

An agent command that never ran must not cost a task its status. Today
`branchling run` counts every non-zero exit of the agent as an attempt, and
after `--max-attempts` it parks the task in the protected status with the
reason "no verification after N agent attempts" — the same outcome whether the
agent worked for an hour and failed the contract, or exited in two seconds
because it could not authenticate.

Once this is done, a run whose agent could not start reports that, leaves the
task in the status it took it from, and exits non-zero.

## Context

Measured on 2026-09-03 on this repository, in the first unattended run of the
new plan:

    branchling run --agent "claude -p --dangerously-skip-permissions" \
      --max-tasks 1 --max-attempts 2

Both attempts produced one line of agent output — `Failed to authenticate:
OAuth session expired and could not be refreshed` — in 57 seconds each. The
tree was untouched. `done` then failed for the only reason it could (the test
the task asks for does not exist yet, because nobody wrote it), and TL-183 was
parked as `blocked`, owned by `agent:claude`, with a reason that describes the
work rather than the environment. Restoring it took a hand edit and a
`history` entry saying what really happened.

**The distinction is not "did the agent fail" but "did the agent RUN".** A task
whose contract fails after real work is a fact about the task and belongs in
its file. A task whose agent never started is a fact about the machine and
belongs in the run report, nowhere else. Writing the second into the task file
is the tool telling a lie that survives the session.

**What counts as never started, precisely.** This must not become a heuristic
over exit codes — every agent uses them differently. Two signals are available
and neither needs to understand the vendor:

- the agent produced no output at all, or only output on stderr, AND
- nothing in the tree changed between the take and the attempt's end
  (`git status --porcelain` over the repository, which `run` can already take
  before and after).

An attempt that changed nothing and said nothing is not an attempt. Whether
BOTH are required or either suffices is the decision to make while
implementing; the safe direction is both, because a false "never started"
would let a genuinely failing task loop forever.

**A run that could not start its agent must exit non-zero.** Today the run
above exited 0 with "1 blocked", which in a cron entry reads as success. An
unattended queue is exactly where nobody is left to read the report.

## Pre-flight reading

1. `scripts/run-loop.mjs` — the attempt loop, the stuck-status write and the
   report; this is where all three changes land.
2. `scripts/instructions/autonomous-loop` (via `branchling instructions
   autonomous-loop`) — the promise this task is keeping: the loop is
   composition, and the agent is a command of the user's.
3. `scripts/tests/` — the existing run-loop tests, for the fixture shape; the
   new test must use a fake agent command, never a real vendor CLI.

## Steps

1. Capture whether the tree changed across an attempt, and whether the agent
   wrote anything.
2. When an attempt neither ran nor changed anything, stop the run for that task
   instead of counting the attempt: restore the status it was taken from, and
   name the agent command and its output in the report.
3. Exit non-zero when a run ended that way.
4. `scripts/tests/run-agent-launch.test.mjs`: a fixture backlog, an agent
   command that exits non-zero printing one line to stderr, and an assertion
   that the task is left in its original status and the exit code is not 0.

## Decisions

Nothing decided beyond the above. The `--max-attempts` semantics for a REAL
failure do not change.
