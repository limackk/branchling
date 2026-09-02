---
id: TL-157
title: "The actor chain has one home, and it reads the user layer"
type: code
labels: []
board: main
epic: ""
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: [TL-34]
blocks: []
related_docs: []
verification:                      # HOW to check that the task is really done
  - id: one-chain
    bash: "test $(grep -c 'BACKLOG_ACTOR' scripts/*.mjs | grep -v ':0$' | grep -v 'actor.mjs' | wc -l) -le 1 && echo 'the chain has one home — OK'"
  - id: preference-is-read
    bash: "node --test scripts/tests/home.test.mjs scripts/tests/history.test.mjs scripts/tests/next.test.mjs"
  - id: guards
    bash: "node scripts/cli.mjs check"
---

## Goal

`actor` is resolved in ONE place, that place reads the user preferences layer,
and a person who writes `actor: local:me` once in their own config file is that
actor in every command that records anything.

## Context

TL-34 added the user layer — `<config>/config.yaml`, with `actor` as its
headline key — and deliberately did NOT wire it into the commands. This is that
wiring, and it is a refactor before it is a feature.

**The chain is written out eight times.** `grep BACKLOG_ACTOR scripts/*.mjs`
finds it in `activity-command.mjs` (twice), `done-task.mjs`,
`focus-command.mjs`, `history-record.mjs`, `migrate-prefix.mjs`,
`regen-hook.mjs`, `seed-backlog.mjs` and `take-task.mjs`. Each spells
`flag || process.env.BACKLOG_ACTOR || "agent:claude"` — except `seed-backlog.mjs`,
whose fallback is `"unknown"`, and `migrate-prefix.mjs`, which has no fallback
at all. So the chain is not merely duplicated, it already DISAGREES, and nobody
noticed because no test compares the eight.

**Threading a ninth source through eight copies is the wrong move**, which is
why TL-34 stopped rather than doing it. The right one is a single
`resolveActor(flag, opts)` — flag, then `BACKLOG_ACTOR`, then the user layer,
then the default — with every call site pointing at it. `take-task.mjs` already
exports a function by that name; the work is making it the only one and giving
it the fourth source.

**One thing to decide rather than assume:** where the default `agent:claude`
belongs once a user layer exists. A person who has set `actor:` should never see
it; a person who has not still needs a value, and `unknown` versus
`agent:claude` is a real choice, since `unknown` is a RESERVED word elsewhere in
this project (the reason field). Record the decision in this file.

**A trap in the obvious implementation.** The user layer is loaded through
`loadConfig()`, which needs a backlog root — and `regen-hook.mjs` and
`migrate-prefix.mjs` resolve an actor in places where a config may not be
loadable. `resolveActor` therefore has to work with the preferences ABSENT, and
must not turn a hook into a failure. Read the layer directly through
`loadUserConfig()` rather than reaching for the whole configuration.

## Pre-flight reading

1. `scripts/home.mjs` — `USER_DEFAULTS`, `loadUserConfig()`. The layer is
   already validated; `actor` is refused unless it is namespaced.
2. `scripts/take-task.mjs` — `resolveActor()`, the function to promote.
3. `git show` on TL-34's commit — why the layer was added without consumers,
   and why that was a boundary rather than an omission.
4. `scripts/tests/history.test.mjs` — how the actor is asserted today.

## Steps

1. Move `resolveActor` into a module of its own, with the user layer as the
   third source.
2. Point all eight call sites at it, and settle the two that disagree today.
3. A test that no call site spells the chain out any more — this is what stops
   the ninth copy appearing.

## Acceptance criteria

- [ ] `BACKLOG_ACTOR` appears in at most one source file. [proof: one-chain]
- [ ] An `actor:` in the user layer is the actor a command records when no flag and no environment variable is given. [proof: preference-is-read]
- [ ] A flag still outranks the environment, which still outranks the preferences. [proof: preference-is-read]
- [ ] Resolution works with no preferences file and with no loadable backlog configuration — a hook must not fail. [proof: preference-is-read]
- [ ] The decision about the default (`agent:claude` vs something else) is written in this file. [proof: guards]

## Notes

- Found while closing TL-34. Deliberately left out of it: adding a layer and
  refactoring eight call sites are two theses, and a blurred task has no
  verification.
- `seed-backlog.mjs` falling back to `unknown` is probably a bug, not a
  decision — but it is recorded in tasks already seeded, so settle it
  explicitly rather than quietly aligning it.
