---
id: TL-460
title: "A manual vouch typed by a person is not attributed to an agent"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-15
updated: 2026-10-15
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A `manual:` verification entry vouched for by a person typing `confirm` at
the `branchling done` prompt is never recorded under the fallback actor
`agent:claude`. Either the vouch carries a stated human actor, or the prompt
says, before it accepts `confirm`, which actor will sign it and how to change
that.

## Context

On 2026-10-15 the owner closed TL-158 from the terminal pane of an agent
session. `done` printed "Vouching is recorded in the history as agent:claude"
and waited for `confirm`. The owner had to abort and rerun with
`--actor user:limack`; the aborted attempt still left an `__unverified__`
record signed `agent:claude` in `backlog/history/TL-158.jsonl`, which is
append-only and stays.

The fallback itself is deliberate. `scripts/actor.mjs` (TL-157) explains why
an unstated actor is `agent:claude` rather than `unknown`, and TL-34 gives a
person the user-layer `actor:` key to state themselves once. That reasoning
holds for automated writes. It does not hold for a manual vouch: the whole
point of that entry is that a PERSON looked, and the prompt is only reached
when a terminal is attached. Recording the act under the one namespace that
means "automated and unverified" inverts what the record is for.

Do not change `DEFAULT_ACTOR` or the resolution order in `scripts/actor.mjs`;
the decision is local to the interactive vouch in `done`.

## Pre-flight reading

1. `scripts/actor.mjs` — the resolution chain and why the default is what it is.
2. The interactive vouch in the `done` command (search `type \`confirm\``) —
   where the prompt is printed and the record written.
3. `scripts/home.mjs` — the user layer that carries `actor:`.

## Steps

1. Make the actor's SOURCE visible to the vouch prompt (explicit flag,
   environment, user layer, or fallback).
2. When the source is the fallback, do not accept `confirm` silently: name the
   options (`--actor user:<name>`, `BACKLOG_ACTOR`, the user-layer `actor:`
   key) and refuse, or ask for the actor, before writing anything.
3. Do not write an `__unverified__` record attributed to the fallback when the
   run stops at that point.
4. Leave `--confirm-manual` (no terminal) unchanged; it is a stated act.

## Acceptance criteria

- [ ] An interactive vouch with no stated actor writes no history record signed
  by the fallback actor, and says how to state one. [proof: suite]
- [ ] A vouch with `--actor`, `BACKLOG_ACTOR` or the user-layer key is recorded
  under that actor, as before. [proof: suite]
