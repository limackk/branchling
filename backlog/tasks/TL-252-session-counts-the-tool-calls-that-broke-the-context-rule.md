---
id: TL-252
title: "session counts the tool calls that broke the context rule"
type: task
labels: []
board: main
epic: "Harness"
priority: P1
status: cancelled                  # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: context-breaches-counted
    bash: "node --test scripts/tests/session-context-breaches.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"

---

## Goal

`branchling session <id>` reports how many tool calls in that session read the
backlog the way `CONTEXT_RULE` forbids — a direct read of a task file, a grep
across `tasks/`, a read of a generated view — and `audit` sums it per actor. A
harness that says "ask, do not read" and cannot say whether anyone listened is
a rule on paper; this gives the rule its first number.

## Context

The `PostToolUse` hook in `.claude/settings.json` fires on every tool
(`scripts/activity-hook.sh`, matcher `*`) and the payload carries `tool_name`,
`tool_input.file_path` and `cwd`. `activity record` reads "what it can use and
ignores the rest" — today that is the heartbeat and the actor. The information
needed to count a breach is therefore already at the hook boundary and is
thrown away.

Why this matters beyond hygiene: TL-103's launch thesis is a measurement of
what the context economy saves. That number rests on `stats --context` — the
cost of each path — and on nothing about which path agents actually take. A
breach count per session is the missing half.

Definition of a breach, kept narrow so the number means something:

- a `Read`/`cat`/`sed`/`head` of a path under `<backlog>/tasks/` that is NOT
  the task the session is focused on (`focus`); reading your own task is the
  intended path;
- a `Grep`/`grep`/`rg` whose target is under `<backlog>/tasks/`;
- a read of `INDEX.yaml`, `NOW.yaml` or a board file.

A `Bash` call is inspected by its command string for those shapes; anything
ambiguous is NOT counted — an undercount is honest, an overcount is an
accusation.

What is stored: one activity record of kind `tool` already exists per
invocation (subject to the throttle). Whether the breach flag rides on that
record or needs its own kind is a decision for the task; the retention rules in
`scripts/activity-retention.mjs` must keep applying to it either way.

Rejected: blocking the call in the hook. `PostToolUse` runs after the fact, and
a `PreToolUse` refusal would make the harness fight the operator — the rule is
about cost, not permission.

## Pre-flight reading

1. `scripts/activity-hook.sh` — the four-line adapter and why it decides nothing
2. `scripts/activity.mjs` — `ACTIVITY_KINDS`, the record shape, the throttle
3. `scripts/activity-command.mjs` — how `record --source hook` parses stdin
4. `scripts/session-report.mjs` — where a new section goes, and the rule that
   an absent section is not a zero
5. `scripts/audit.mjs` — the per-actor table to extend
6. `scripts/context-budget.mjs` — `CONTEXT_RULE`, the definition being counted

## Steps

1. Classify the hook payload into breach / not-breach with a pure function in
   its own module, with the fixtures above as its test.
2. Persist the classification with the heartbeat, honouring the throttle
   (a throttled heartbeat still counts its breach — the count must not depend
   on the window).
3. `session <id>`: a section `context rule: N breach(es) in M tool call(s)`,
   listing the paths, absent when the hook never ran.
4. `audit`: one column per actor.
5. Tests over a recorded fixture log, not over a live session.

## Acceptance criteria

- [ ] A fixture activity log with three breaching and two compliant calls
      yields `3` in `session` and in `audit`. [proof: context-breaches-counted]
- [ ] Reading the focused task's own file is not counted.
      [proof: context-breaches-counted]
- [ ] A session with no hook records prints no section rather than zero.
      [proof: context-breaches-counted]

## Decisions

Nothing decided.
