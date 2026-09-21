---
id: TL-157
title: "The actor chain has one home, and it reads the user layer"
type: task
labels: []
board: main
epic: ""
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
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

- [x] `BACKLOG_ACTOR` appears in at most one source file. [proof: one-chain]
- [x] An `actor:` in the user layer is the actor a command records when no flag and no environment variable is given. [proof: preference-is-read]
- [x] A flag still outranks the environment, which still outranks the preferences. [proof: preference-is-read]
- [x] Resolution works with no preferences file and with no loadable backlog configuration — a hook must not fail. [proof: preference-is-read]
- [x] The decision about the default (`agent:claude` vs something else) is written in this file. [proof: guards]

## Decisions

**The default is `agent:claude`, and the call sites that said `unknown` are
aligned onto it.** `unknown` is not a spare word: it is the sentinel for a
change the tool OBSERVED rather than made — `reconcile()` writes it, and
`isUnattributed()` treats `unknown` with no stated reason as a row still waiting
for a person to claim it. A `seed` or an `import` run is not an observation, it
is an act performed by whoever typed the command, so recording it as `unknown`
filed a deliberate act into the queue of things nobody witnessed. That was a
bug, and the two call sites are the evidence it was never decided. The `agent:`
namespace already carries the right amount of doubt — automated and unverified,
which is exactly what an unstated actor is — and the honesty argument for
`unknown` is answered by TL-34: a person who is not an agent now states who they
are ONCE, in their own config file, instead of on every command.

Rows already written with `unknown` keep it. The log is append-only; a value in
it is what was true when it was written, not a field a later pass may correct.

**`resolveActor(flag, opts)` takes `opts`, not an env.** The old signature was
`(flag, env)`, and a second positional whose meaning changed would be a silent
trap for anything still passing one. `opts.fallback` is the escape hatch for a
route that would rather record nothing than record a guess: pass `""` and the
chain ends unstated.

**The user layer is read through `loadUserConfig()` directly, never through
`loadConfig()`,** and every read is wrapped. `regen-hook` and `migrate-prefix`
resolve an actor where no project configuration can be loaded, so a hook that
threw because somebody's home directory is unusual would break an edit this tool
was only supposed to notice.

**The suite had to be made hermetic in the same change.** Wiring the layer in
made eight test files depend on the DEVELOPER's `~/.config/<tool>/config.yaml`:
a machine with `actor:` set would have seen every default-actor assertion fail,
and on a machine without one — this one — the suite is green for the wrong
reason. They now call `isolateHome()`. The remaining test files are not covered
and there is no guard that a new one will be: TL-166.

## Notes

- Found while closing TL-34. Deliberately left out of it: adding a layer and
  refactoring eight call sites are two theses, and a blurred task has no
  verification.
- `seed-backlog.mjs` falling back to `unknown` is probably a bug, not a
  decision — but it is recorded in tasks already seeded, so settle it
  explicitly rather than quietly aligning it.
