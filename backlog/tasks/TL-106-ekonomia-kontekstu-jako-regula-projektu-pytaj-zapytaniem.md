---
id: TL-106
title: "Context economy as a project rule — ask with a query, do not read the tree"
type: code
labels: [post-launch]
board: main
epic: "Onboarding"
priority: P2
status: done
owner: agent:claude
estimate: 3h
confidence: high
created: 2026-09-01
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs:
  - CLAUDE.md
  - docs/funkcjonalnosci.md
verification:
  - bash: "node --test scripts/tests/context-budget.test.mjs"
  - bash: "node scripts/cli.mjs query --status pending --count"
  - manual: "`CLAUDE.md` at the root and the `context-budget` topic in `worktrail instructions` carry the same rule, with a cost table computed from the current tree rather than hardcoded"
---

## Goal

The agent knows — from a project rule, not a guess — that the backlog is
QUERIED with a command, not read file by file. Session cost stays a function
of a single task even once the backlog grows to several hundred entries.

## Context

The architecture is already correct today: at session start only
`CLAUDE.md` is loaded, the backlog does not enter the context until the
agent reaches for it. Measurement on this tree (88 tasks, 44 active,
2026-09-01):

```
CLAUDE.md (automatic)                          ~940 tok
SKILL.md (when a skill fires)                ~1 810 tok
worktrail stats                                  ~200 tok
query --status pending (44 tasks)            ~2 130 tok
one task file (median)                       ~1 130 tok
─────────────────────────────────────────────────────────
typical single-task session                  ~6 000 tok   ≈ 3% of the 200k window

naive path: cat tasks/*.md                 ~115 500 tok   ≈ 58% of the window
backlog/INDEX.yaml                           ~2 400 tok   (and STALE)
```

Three things break this architecture and none of them is recorded anywhere
today:

1. **Looking for work scales linearly, work does not.** `query --status
   pending` costs ~48 tokens per task. At 44 tasks that is ~2,100; at 400 —
   **~19,400 tokens just to ask "what now"**, three times the rest of the
   session. The intended fix is `worktrail next` (TL-104, constant cost);
   until then the rule is `--count` and `stats` instead of the full list, and
   the full list only with a filter.
2. **Nothing guards against the naive path.** A `Read` on the tasks
   directory, or a broad grep, pulls in 115k tokens and the session is
   cooked before it starts work. `CLAUDE.md` says not a word about it; the
   skill only says so once it fires, and it does not always fire.
3. **`INDEX.yaml` is a double trap**: it costs ~12x more than `stats` and is
   a snapshot of the last `build`, so it answers stale. On top of that it
   sits in an obvious place and looks like the index to reach for.

At 88 tasks this does not hurt. At 400 it will decide whether autonomous
mode works at all — and the backlog is growing precisely because the tool
works.

**Settled: the rule has one source.** It goes into `CLAUDE.md` (because that
is the only thing loaded automatically) AND as the `context-budget` topic in
`worktrail instructions` (TL-74) — but as one text from one place, not two
copies that drift apart. If TL-74 has not landed yet, start with `CLAUDE.md`
and leave a hook.

**Settled: the cost table is COMPUTED, not hardcoded.** Hardcoded numbers
would go stale the first time the backlog grows, and start teaching a
falsehood — the same class of bug as a README describing someone else's
project. Hence `worktrail stats --context` or equivalent: the cost of each
path's answer computed from the current tree.

## Pre-flight reading

1. `CLAUDE.md` — section "Before you change the code"; the rule needs to
   match its tone and brevity there. This is a file loaded into EVERY
   session, so every sentence costs.
2. `.claude/skills/backlog-workflow/SKILL.md` — section "Find work"; today
   it says to use `--count`, but not WHY or what not to do.
3. `scripts/stats.mjs` and `scripts/query.mjs` — where to get the numbers
   for the computation from.
4. `backlog/tasks/TL-104-*.md` — `worktrail next`, the intended fix for
   point 1.

## Steps

1. Write the rule: **ask with `query`/`stats`/`next`, do not read
   `tasks/*.md` in bulk and do not read generated views.** Keep it short —
   this rides along in every session.
2. Add it to `CLAUDE.md` with one sentence of justification (58% of the
   window for one careless read) and with the reason generated views are
   doubly disqualified: cost and staleness.
3. `worktrail stats --context` (or equivalent): the cost of each path's
   answer computed from the current tree — what `--count`, `stats`, the
   full list, one task, the whole tree each cost.
4. The `context-budget` topic in `instructions` (TL-74) from the same
   source.
5. Consider a warning in `doctor` when the full list exceeds a threshold —
   and settle the threshold with a value, not a hunch (e.g. a share of a
   typical window).
6. `scripts/tests/context-budget.test.mjs`: `--count` is an order of
   magnitude cheaper than the full list on the fixture; the numbers in the
   table come from the tree (the test fails if someone hardcodes them); the
   rule is present in `CLAUDE.md`. Positive control: a fixture with a
   different task count gives different numbers.

## Acceptance criteria

- [ ] The "ask, do not read" rule is in `CLAUDE.md`, short and justified.
- [ ] There is one source for the rule; `instructions` and the skill draw
  from it, not copy it.
- [ ] Costs are computed from the current tree, not hardcoded.
- [ ] The reason for rejecting generated views covers BOTH arguments: cost
  and staleness.
- [ ] A test fails when numbers get baked into code or the rule disappears
  from `CLAUDE.md`.

## Log

2026-09-01 pending — agent:claude — created after measuring context loading:
a single-task session is ~6,000 tokens (3% of the window), but `cat
tasks/*.md` is ~115,500 (58%), and looking for work scales linearly —
~19,400 tokens at 400 tasks. The architecture is good, nowhere is it a rule.
</content>
