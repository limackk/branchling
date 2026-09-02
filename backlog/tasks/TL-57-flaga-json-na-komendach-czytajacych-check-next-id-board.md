---
id: TL-57
title: "The --json flag on reading commands: check, next-id, board"
type: task
labels: [pre-launch]
board: main
epic: "CLI surface"
priority: P2
status: pending
owner: unassigned
estimate: 4h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
  - .claude/skills/worktrail-cli/SKILL.md
verification:
  - bash: "node --test scripts/tests/json-output.test.mjs"
  - bash: "node scripts/cli.mjs check --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log('check --json parses, guards:',Array.isArray(r)?r.length:Object.keys(r).length)})\""
  - bash: "node scripts/cli.mjs next-id --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{JSON.parse(s);console.log('next-id --json parses — OK')})\""
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

`docs/worktrail-global-tool.md` §3 states this as one of the four laws and
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

1. `docs/worktrail-global-tool.md` §3, Law 4.
2. `scripts/query.mjs` and `scripts/stats-report.mjs` — the two existing
   `--json` patterns.
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

- [ ] `check`, `next-id`, `board` accept `--json`.
- [ ] With `--json`, stdout contains only JSON — verified by a test,
      including for an empty result.
- [ ] `check --json` names the guard that failed and preserves the exit
      code.
- [ ] `next-id --json` carries the number's source (`repo` / `local`).
- [ ] `new-task.mjs` no longer parses stdout line by line.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from an audit of the CLI surface
