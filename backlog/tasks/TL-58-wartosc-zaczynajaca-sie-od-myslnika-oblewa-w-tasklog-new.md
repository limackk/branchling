---
id: TL-58
title: "A value starting with a dash fails in worktrail new"
type: bug
labels: [post-launch]
board: main
epic: "CLI surface"
priority: P3
status: done
owner: agent:dev
role: dev
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-04
blocked_by: []
blocks: []
related_docs:
  - .claude/skills/branchling-cli/SKILL.md
verification:
  - bash: "node --test scripts/tests/new-task.test.mjs"
  - bash: "d=$(mktemp -d) && node scripts/cli.mjs init --dir \"$d\" >/dev/null && node scripts/cli.mjs new --dir \"$d\" --title -- '--json on reading commands' >/dev/null && ls \"$d\"/tasks | grep -q json && echo 'title with a dash — OK'"
---

## Goal

Allow a flag value that starts with `-`, because today a task title about a
CLI flag cannot be saved.

## Context

Measured on 2026-08-31 while creating tasks from the same audit:

```
<!-- language-guard: allow — verbatim historical CLI transcript, not prose -->
$ worktrail new --title "--json na komendach czytających: check, next-id, board" …
<!-- language-guard: allow — verbatim historical CLI transcript, not prose -->
[worktrail new] --title wymaga wartości
```

The cause is in `parseArgs()` in `scripts/new-task.mjs`: the condition
`argv[i + 1].startsWith("-")` treats any value starting with a dash as a
missing value. This heuristic exists so that `--title --board main` fails
instead of creating a task titled "--board" — and that is a legitimate goal.
The price is that a value that LEGITIMATELY starts with a dash becomes
unsaveable.

The standard resolution of this ambiguity is the `--` separator: everything
after it is a value, never a flag. This is a convention a CLI user already
knows from `git`, `rm`, and `xargs`, so it needs no explanation in the
help — it only needs to be handled.

**The scope is wider than `new`.** The same pattern sits in other commands
(`query --text -foo`, `migrate-prefix`). This task should check all flag
parsers, not just the one the problem surfaced on.

Low priority, because the workaround is immediate (rephrasing the title),
and the direct loss is one blocked form of input. This does not mean the
defect is harmless: it is a parser that confuses a value with a flag, the
same class as a silent no-op — except it fails loudly, so it costs a minute
instead of a day.

## Pre-flight reading

1. `scripts/new-task.mjs` — `FLAGS`, `parseArgs()`.
2. `scripts/query.mjs` — a second flag parser, the same condition to check.
3. [TL-25](TL-25-domknij-walidacje-flag-w-5-komendach-tasklog.md) — why an unknown flag fails; this rule stays untouched.

## Steps

1. Handle `--` in a common way: everything after the separator is a positional value or the value of the preceding flag.
2. Keep today's protection: `--title --board` WITHOUT a separator still fails, because it is almost certainly a mistake.
3. Review the remaining flag parsers from the same angle; if the pattern repeats, that is an argument for a shared parser, but extracting it is a separate task, not this one.
4. Tests: a title starting with `-` passes after the separator; `--title --board` without a separator still fails with code 2.

## Acceptance criteria

- [ ] `worktrail new --title -- "--json …"` creates a task with this title.
- [ ] `worktrail new --title --board main` still fails with code 2.
- [ ] The remaining flag parsers checked; the review result recorded in `## Log`.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — defect hit while creating TL-57
