---
id: TL-209
title: "The viewer's write paths cannot refuse a bad actor"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: cancelled                  # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: bad-actor
    bash: "node --test scripts/tests/decision-api.test.mjs"
---

## Goal

A write posted to the viewer's server with an actor the tool cannot parse is
REFUSED, rather than recorded as somebody else.

## Context

Found on 2026-09-03 while adding `choose` to `/api/decision` (TL-205).

`scripts/serve-backlog.mjs:748` reads:

    const who = normalizeActor(actor || ACTOR_UNKNOWN);
    if (!isValidActor(who)) { 400 "The actor ... has no valid namespace" }

`normalizeActor` is defined as `isValidActor(actor) ? actor : ACTOR_UNKNOWN`
(`scripts/task-fields.mjs:87`), and `ACTOR_UNKNOWN` is itself valid. So `who`
is valid by construction and **the branch below it can never be taken**. The
error message it holds has never been sent.

**What happens instead is worse than the message it replaced.** A client that
sends `founder`, or `human:kim`, or any string outside the three namespaces
gets `200` and an entry attributed to `unknown` — the value the tool reserves
for *a change nobody can be asked about*, which is a different claim and one
nothing supports here. The history's whole value is that it says who did what;
this path quietly writes the sentinel for "we do not know" over an answer
somebody actually gave, and the client is never told its attribution was
dropped.

Measured: a `POST /api/decision` with `actor: "human:kim"` returns 200 and the
appended record carries `"actor":"unknown"`.

**The two calls are not interchangeable and the choice belongs to the caller.**
`normalizeActor` is right for RECONCILIATION, where a change is observed after
the fact and no actor exists to ask. It is wrong for a request, where there is
a caller who can be told. This is the only `normalizeActor` call in the server.

## Pre-flight reading

1. `scripts/serve-backlog.mjs:748` and every other write route — whether any
   other one takes an actor and what it does with it.
2. `scripts/task-fields.mjs:70-89` — `ACTOR_NAMESPACES`, `isValidActor`,
   `normalizeActor`, and the comment on why `unknown` is a value.
3. `scripts/tests/decision-api.test.mjs` — the harness that posts to the route.

## Steps

1. Validate the SUPPLIED actor and refuse a bad one; keep `unknown` reachable
   only for a request that declares no actor at all, if that is still wanted.
2. Decide, and write down, whether an absent actor is also a refusal — the page
   already blocks a write with no actor declared, so the server accepting one
   is a second, softer rule in a second place.
3. A test posting `human:kim` (a plausible near-miss: a real namespace shape,
   not one of the three) and asserting a refusal with nothing appended.

## Acceptance criteria

- [ ] A write with an unparseable actor is refused and appends nothing.
      [proof: bad-actor]
- [ ] The suite stays green. [proof: suite-green]
