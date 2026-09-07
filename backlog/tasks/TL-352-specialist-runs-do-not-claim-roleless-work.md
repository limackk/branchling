---
id: TL-352
title: "Specialist runs do not claim roleless work"
type: bug
labels: [agents, routing]
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: role-routing
    bash: "node --test scripts/tests/run-roles.test.mjs scripts/tests/run-agent-profiles.test.mjs"
---

## Goal

An invocation with only `--profile-for dev=…` or `--agent-for dev=…` never
claims a roleless task. It either dispatches a `dev` task or reports roleless
work as awaiting a generalist, so a specialist run cannot accidentally take
unrelated work.

## Context

During the real TL-242 role-routing run, `next --role dev` selected roleless
TL-229 because `next` intentionally treats `--role dev` as "dev or anyone".
That inclusive behavior is useful for a human who can do general work, but a
`run` with specialists only has no hand for `role: ""`. A dispatch route must
not claim work it has already decided it cannot execute.

TL-242 also retained a reservation after its spec handoff; that separate
atomicity issue is TL-351. This task concerns the selection contract only.

## Pre-flight reading

1. `scripts/run-loop.mjs` — inspect how a specialist routing map becomes the
   `next` invocation and how unserved work is reported.
2. `scripts/next-task.mjs` — preserve the documented inclusive meaning of
   `--role` for direct callers and use `--role-strict` only where appropriate.
3. `scripts/tests/run-roles.test.mjs` — extend the established routing fixture
   with a roleless positive control.

## Steps

1. Make a specialists-only `run` request exact role matches from `next`.
2. Keep a generalist-enabled run able to serve roleless work.
3. Add a regression fixture proving a roleless task remains pending and is
   reported as awaiting a generalist, while a mapped role is still dispatched.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] A specialists-only run does not claim, mutate, or lock a roleless task.
  [proof: role-routing]
- [ ] A task with a role served by the same run is still dispatched to its
  mapped profile or command. [proof: role-routing]
- [ ] Direct `next --role dev` retains its documented inclusive behavior; the
  stricter selection is confined to the specialist dispatcher. [proof: role-routing]
