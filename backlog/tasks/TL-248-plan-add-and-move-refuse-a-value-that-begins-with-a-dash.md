---
id: TL-248
title: "plan add and move refuse a value that begins with a dash"
type: bug
labels: []
board: main
epic: "CLI surface"
priority: P3
status: done
owner: agent:claude
role: ""
executor: ""
estimate: 30m
confidence: high
created: 2026-09-04
updated: 2026-09-21
blocked_by: []
blocks: []
related_docs: []
# TL-260 measured this block against an unchanged tree and it PASSED: the whole
# of plan-write.test.mjs was green before a line of this task was written, so the
# contract could not tell a fix from no work at all. The first entry now names
# only the cases added here — every one of them fails against today's parser —
# and the file-wide and suite-wide runs follow it, so a fix that breaks a
# neighbouring promise is still caught.
verification:
  - id: separator-in-plan
    bash: "node --test --test-name-pattern separator scripts/tests/plan-write.test.mjs"
  - id: plan-write-file
    bash: "node --test scripts/tests/plan-write.test.mjs"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`plan add <ID> --wave "…" --why -- "--json is not free"` writes the reason as
typed, so a wave or a reason ABOUT a flag can be recorded at all.

## Context

Surfaced on 2026-09-04 while closing TL-58, which fixed exactly this in
`new`, and deliberately left this parser alone because the task's own Steps
say that a shared parser is a separate task.

`parseEditArgs()` in `scripts/plan-write.mjs` carries the identical line
TL-58 removed from `scripts/new-task.mjs`:

```
if (argv[i + 1] === undefined || argv[i + 1].startsWith("-")) return { error: a + " requires a value" };
```

Any value whose first character is a dash is read as a missing value. The
heuristic is legitimate — `--why --wave 3` is almost certainly a mistake, and
a plan entry whose reason is `--wave` is the silent no-op this tool refuses
to be — but with no separator to escape it, a legitimate value is simply
unwritable. `--why` is the flag that hurts: it takes a sentence, and this
project's sentences are about flags.

MEASURED IN THIS TREE on 2026-09-04, from a `plan add` on a fresh fixture:

```
branchling plan add: --why requires a value
```

THE SURVEY THAT PRODUCED THIS TASK. Three shapes exist in `scripts/`:

1. Refuse a dash value outright — `new` (fixed by TL-58) and this parser.
   This is the only one left.
2. Take `argv[++i]` unconditionally — `done`, `take`, `query` and most
   others. A dash value works there; the cost is the opposite failure, a
   mistyped flag swallowed as a value, which is not this task.
3. Strip a global flag from anywhere on the line, separator or not —
   `takeDirFlag()` and `takeColorFlags()` in the dispatcher. That is TL-247,
   already filed.

A SHARED PARSER IS NOT WHAT THIS ASKS FOR. Two call sites is not yet an
argument for extracting one, and an extraction would touch every command at
once. Copy the shape TL-58 settled — see `parseArgs()` in
`scripts/new-task.mjs` and its comment — into this one parser. If a third
site appears, that is when the extraction earns its own task.

## Pre-flight reading

1. `scripts/plan-write.mjs` — `FLAGS`, `parseEditArgs()`.
2. `scripts/new-task.mjs` — `parseArgs()`, the shape to copy and the reasoning
   behind it.
3. `scripts/tests/new-task.test.mjs` — the five cases TL-58 was proved with;
   the same five apply here.

## Steps

1. Write the failing cases in `scripts/tests/plan-write.test.mjs` first: a
   `--why` value beginning with a dash after `--`; a known flag name as the
   value after `--` setting no other field; and the three that must stay
   green — no separator still fails, `--why --` alone fails, and an argument
   left over past the value is refused rather than dropped.
2. Split the arguments at the first `--` in `parseEditArgs()`; only the last
   flag before the separator reaches past it, and only that one is exempt
   from the dash check.
3. Note that `parseEditArgs()` collects positional ids, unlike `new` — decide
   in the test whether a leftover past the separator is an id or an error,
   and say which in the commit body.

## Acceptance criteria

- [x] A `--why` value beginning with a dash is written as typed when it
      follows `--`. [proof: separator-in-plan]
- [x] After `--` a KNOWN flag name is the value and sets no other field.
      [proof: separator-in-plan]
- [x] Without a separator, `--why --wave` still fails with code 2 and writes
      nothing to `plan.yaml`. [proof: separator-in-plan]
- [x] `--why --` with nothing after the separator fails with code 2.
      [proof: separator-in-plan]
- [x] An argument left over past the separator's value is refused by name
      rather than collected as a second id. [proof: separator-in-plan]
- [x] Every other promise plan-write.test.mjs makes is unchanged.
      [proof: plan-write-file]
- [x] The suite stays green. [proof: suite]
