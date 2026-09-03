---
id: TL-57
title: "The --json flag on reading commands: check, next-id, board"
type: task
labels: [pre-launch]
board: main
epic: "CLI surface"
priority: P2
status: done
owner: agent:claude
estimate: 4h
confidence: high
created: 2026-08-31
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs:
  - docs/branchling-global-tool.md
  - .claude/skills/branchling-cli/SKILL.md
verification:
  - id: json-only
    bash: "node --test scripts/tests/json-output.test.mjs"
  - id: envelope-contract
    bash: "node --test scripts/tests/json-envelope.test.mjs"
  - id: check-json-parses
    bash: "node scripts/cli.mjs check --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);if(!Array.isArray(r.guards)||!r.guards.length) throw new Error('no guards in the document'); console.log('check --json parses, guards:', r.guards.length)})\""
  - id: next-id-json-parses
    bash: "node scripts/cli.mjs next-id --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);if(!r.source) throw new Error('no source on the number'); console.log('next-id --json parses, source:', r.source)})\""
  - id: guards
    bash: "node scripts/cli.mjs check"
---

## Goal

Close out Law 4 — "`--json` on every reading command" — because today it is
a description of two commands, not a rule.

## Context

Measured 2026-08-31, `grep '--json' scripts/*.mjs`:

| Command | reads? | `--json` |
|---|---|---|
| `query` | yes | present |
| `stats` | yes | present |
| `check` | yes | **missing** |
| `next-id` | yes | **missing** |
| `board` | yes | **missing** |

`docs/branchling-global-tool.md` §3 states this as one of the four laws and
derives all extensibility from it: "no plugin API, because `--json` on every
reading command and a callable input on every writing one." A law that holds
in two commands out of five is not a basis for extensibility — it is a
description of the current state.

The practical cost is visible today in `new-task.mjs`: the number from
`next-backlog-id.mjs` is read **from stdout, as the last line**, then
validated with a regex, so that a scanner failure does not produce a
`BL-NaN-*.md` file. This is a workaround for exactly this missing flag.
`--json` turns "the last line of stdout, hopefully a number" into a field.

The greatest value here is `check --json`: this is the command someone will
wire into CI or into a hook, and they will want to know WHICH guard failed
and on what — not just that the exit code is nonzero.

**A constraint that is easy to break:** with `--json`, stdout may contain
nothing but JSON. A heading, a `✓`, or a warning added "just for a moment"
break parsing for every consumer at once. Diagnostics go to stderr.

The exit code stays unchanged: `check --json` that found a violation still
fails. JSON describes the result, it does not replace the exit code.

## Pre-flight reading

1. `docs/branchling-global-tool.md` §3, Law 4.
2. `scripts/json-envelope.mjs` — the envelope every `--json` answer shares
   (TL-72), and the rule that a declared key is never absent.
3. `scripts/new-task.mjs` — the `nextId()` function, the workaround this
   task removes.
4. `scripts/cli.mjs` — `check` is a composite command (three guards, exit
   code = the worst of them); the JSON must preserve that.

## Steps

1. `check --json`: one document for the whole run — a list of guards, for
   each a name, result, count of things checked, and a list of violations.
   Exit code still the worst of the guards.
2. `next-id --json`: the number, the full ID and the **source**
   (`repo` / `local`) — today a warning about a narrower source only goes to
   stderr as prose, and this is information the program should be able to
   react to.
3. `board --json`: the suggested board plus the rule it came from.
4. Clean up `new-task.mjs` so it reads `next-id --json` instead of the last
   line of stdout.
5. `scripts/tests/json-output.test.mjs`: for every reading command, the
   `--json` output parses, including with zero results, and stdout contains
   nothing but JSON.
6. Add `--json` to the allow-list of flags for each of these commands
   (today an unknown flag fails).

## Acceptance criteria

One line each: the parser reads the `- [ ]` line and nothing under it (TL-118).

- [x] `check`, `next-id` and `board` accept `--json`. [proof: check-json-parses, next-id-json-parses, json-only]
- [x] With `--json`, stdout carries the document and NOTHING else — asserted on an empty backlog as well as a populated one. [proof: json-only]
- [x] `check --json` names the guards that failed and preserves the exit code. [proof: json-only]
- [x] `next-id --json` carries the number's source (`repo` / `local`). [proof: next-id-json-parses, envelope-contract]
- [x] `new-task.mjs` no longer parses the last line of stdout. [proof: json-only]
- [x] The guard set is one list, read by both the text mode and the JSON mode. [proof: json-only]
- [x] The manual documents the new kind, and the guards still pass. [proof: envelope-contract, guards]

## Decision (2026-09-02)

**Two of the three were already done, and the task was stale rather than
wrong.** `next-id --json` and `board --json` landed with TL-72, which introduced
the envelope — `next-id` even carries the `source` this task asks for, plus the
trees and branches the scan read. What was genuinely missing was `check --json`,
which is also the one the Context calls the greatest value, and the
`new-task.mjs` workaround. The contract was rewritten to assert what is now
true rather than left describing a state that has moved.

**`check --json` CAPTURES its guards instead of letting them print.** The
constraint is absolute and it is the whole reason this is more than a flag: with
`--json`, stdout carries the document and nothing else, because a `✓` from one
guard breaks parsing for every consumer at once — and breaks nothing the author
will ever see, since the author reads the terminal. So the guards' output is
captured, with colour forced off, and reaches the consumer as a string field.

**The eleven `if (plan.wantX)` blocks became a table.** Not tidying: the JSON
mode has to run the same set the text mode runs, and two lists of eleven guards
would differ the first time somebody added a twelfth to one of them — silently,
because a JSON consumer has no way to notice a guard that is not there. `args`
stays a function per guard because the input conventions genuinely differ (one
takes the tasks directory positionally, most take `--dir`, two take nothing),
and the discrepancy belongs on the dispatcher's side.

**`failed` is a first-class key beside `guards`.** A consumer that had to filter
the list to learn which guard to look at would re-implement the question every
time. `output` beside each guard is text written for a PERSON and may be
reworded; `name`, `ok` and `exit` are the contract.

**The exit code is unchanged, and there is a test for it.** `check --json` that
found a violation still exits non-zero. Two answers with no rule about which one
wins is worse than one answer.

**The workaround this removes was in the tool's own code.** `new-task.mjs` took
the number from the last line of `next-backlog-id.mjs`'s stdout and tested it
against `/^\d+$/` — and that regex was not caution, it was the only thing
standing between a scanner printing something unexpected and a file called
`TASK-NaN-*.md`. That call site is why Law 4 is a law rather than a description.

**One path returns before any guard runs**, when the configuration cannot be
read. It prints to stderr and leaves stdout empty, which is asserted: a friendly
sentence there would be exactly the failure this task exists to prevent.

## Verification

```bash
# 1. JSON and nothing else, on an empty backlog and a populated one — expected: pass
node --test scripts/tests/json-output.test.mjs

# 2. The envelope's own contract, now with the `check` kind — expected: pass
node --test scripts/tests/json-envelope.test.mjs

# 3. The whole run as one document — expected: it parses and lists guards
node scripts/cli.mjs check --json | node -e "let s='';process.stdin.on('data',d=>s+=d)\
  .on('end',()=>{const r=JSON.parse(s);console.log('guards:',r.guards.length,'ok:',r.ok)})"

# 4. The number carries its source — expected: repo or local
node scripts/cli.mjs next-id --json | node -e "let s='';process.stdin.on('data',d=>s+=d)\
  .on('end',()=>{console.log('source:',JSON.parse(s).source)})"

# 5. The guards
node scripts/cli.mjs check
```

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from an audit of the CLI surface
