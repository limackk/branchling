---
id: TL-70
title: "A comment beside a template field enters the field's value"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open-source publication"
priority: P1
status: done
owner: agent:claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "d=$(mktemp -d); node scripts/cli.mjs init --dir \"$d\" >/dev/null && node scripts/cli.mjs new --dir \"$d\" --title 'Parser check' >/dev/null && node scripts/cli.mjs query --dir \"$d\" --json | grep -q '\"epic\": \"\"' && { echo 'epic empty — OK'; rm -rf \"$d\"; } || { echo 'the comment ended up in the field value'; rm -rf \"$d\"; exit 1; }"
---

## Goal

`worktrail new` on a fresh backlog has to give a task whose fields hold the
values written in the template — not the text of the comment standing after
the value.

## Context

Measured on 2026-08-31 on a clean tree from `worktrail init`:

```console
$ worktrail new --title "Napisz README"
$ worktrail query
<!-- language-guard: allow — verbatim buggy CLI output being diagnosed, not prose -->
- {id: TASK-2, …, epic: "\"                           # wolny tekst — grupa, w której ten task się liczy", title: "…"}
```

The frontmatter parser does not strip a `#` comment standing **after a
quoted value**. The line `epic: ""   # wolny tekst — …` gives a value that
is the concatenation of the second quote mark and the entire comment.

This is visible in the FIRST minute of working with the tool: `_template.md`,
written by `worktrail init`, comments eight fields this way, and `epic` is
the only one of them whose default value is an empty string in quotes — the
rest (`labels: []`, `board: main`, `priority: P1`) are not quoted, so they
pass through unaffected. The effect shows up in `query`, in `--json`, in
INDEX, and in the viewer: the tool shows itself as broken before the user
has done anything.

A choice that has to be made deliberately: fix the parser (a comment after a
closed quote is a comment) or remove the comment from this one template
line. **Fixing the parser is the right choice** — a comment beside a field is
a convention throughout `config.yaml` and `_template.md`, and a workaround by
removing the comment leaves the trap in place for anyone who comments their
own text field. Removing the comment is not a fix, only sidestepping the
sample.

Found while working on TL-49 (rewriting the README) — the "first five
minutes" flow from the README goes through exactly this path.

## Pre-flight reading

1. `scripts/task-fields.mjs` — the frontmatter parser and field validation.
2. `_template.md` in the repository root — the template that `init` copies.
3. `docs/backlog-config-and-portability.md` — the shape/values boundary.

## Steps

1. Reproduce the bug: `worktrail init --dir <tmp>` → `worktrail new --dir
   <tmp> --title x` → `worktrail query --dir <tmp> --json`.
2. Fix the stripping of a comment after a closed quote in the frontmatter
   parser; a comment INSIDE a quote has to stay part of the value.
3. Add a unit test for both sides: `a: "x" # c` → `x`, and `a: "x # c"` →
   `x # c`.
4. Check whether the same path also affects `config.yaml` and
   `boards.yaml`.

## Acceptance criteria

- [x] `worktrail new` on a fresh `init` gives `epic: ""`.
- [x] The test covers a comment after the value AND a `#` inside a quote.
- [x] Positive control: the test fails on the pre-fix code.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — found while working on TL-49, on the
  flow from the README
- 2026-09-01 in_progress — agent:claude — five copies of the frontmatter
  parser, one correct; fixed by consolidating onto `task-fields.mjs`
- 2026-09-01 done — agent:claude — the parser consolidated onto
  `task-fields.mjs` (`stripComment`/`unquote` exported); fixed: `query.mjs`,
  `build-backlog.mjs`, `parseBoardsYaml`,
  `check-backlog-{boards,refs,id-collisions}.mjs`, `migrate-prefix.mjs`. New
  `scripts/tests/frontmatter-comments.test.mjs` — each of the seven fixes has
  its own positive control (fails when only that file is reverted). 367/367
  green.
