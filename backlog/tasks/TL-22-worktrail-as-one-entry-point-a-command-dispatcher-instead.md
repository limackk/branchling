---
id: TL-22
title: "worktrail as one entry point: a command dispatcher instead of eight paths"
type: task
labels: [pre-launch]
board: main
epic: "branchling — the tool"
priority: P1
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs:
  - docs/branchling-state-and-sync.md
verification:
  - bash: "./scripts/worktrail query --status blocked --priority P0,P1  # a list of tasks, NOT an open browser"
  - bash: "./scripts/worktrail querry  # exit 2 with a list of commands"
  - bash: "./scripts/worktrail serve --frobnicate  # exit 2, the server does NOT start"
  - bash: "node --test backlog/scripts/tests/cli.test.mjs"
---

## Goal

Remove the defect reported by the founder: **every "command" other than the
server silently opened a page** instead of doing anything.

## Context

`scripts/worktrail` was 15 lines and ended in `exec node serve-backlog.mjs
"$@"` — it was hard-wired to ONE script. The server only read the flags it
knew about (`--port`, `--no-open`, `--dir`) and **ignored the rest**, after
which `probeExisting()` saw a running instance and did the only thing it
knew how to do: open a tab.

Effect: `worktrail query --status blocked` ended up at
`http://127.0.0.1:4321/#tasks?board=__all__`. **A silent no-op with a side
effect is worse than an error, because it looks like it worked.**

This was not a design decision, just a leftover: the wrapper was created when
the only thing to launch was the server, and eight further capabilities grew
up alongside it as separate `node backlog/scripts/<something>.mjs` calls,
each with its own flag convention.

A second trap of the same class, found along the way:
`check-backlog-boards.mjs` without `--all <dir>` ended **green on "0 tasks
checked"** — a green result with zero evidentiary force.

**Rejected alternative — flags without subcommands**
(`worktrail --status blocked`, which is what the founder literally asked
about). `worktrail --port 4400` already meant "run the server". If the flag
chose the command, `--status` would mean "query", `--port` would mean
"serve", and `--dir` — accepted by BOTH — would not settle anything. Deciding
the command by whichever flag someone happened to type is a guaranteed source
of drift. A subcommand removes the ambiguity and **preserves the habit**:
`worktrail` with no arguments is still the server.

**Rejected alternative — import instead of spawn.** The scripts are
standalone programs with their own flag validation and exit codes. Rewriting
them as libraries with a thin `main` is separate work; a dispatcher that
calls them and PROPAGATES the exit code gives a single entry point without
touching five working programs.

## Steps

1. `backlog/scripts/cli.mjs` — command table, `helpText()`, a PURE
   `resolveCommand()`, a `main()` that propagates the exit code.
2. `serve-backlog.mjs` — an unknown flag or unexpected argument FAILS (exit
   2) instead of being ignored.
3. `check` as a composite command: adds `--all <tasksDir>` and a positional
   directory, because the two guards have two different input conventions.
4. `scripts/worktrail` → a bridge to `cli.mjs`; `package.json` → `node
   backlog/scripts/cli.mjs`.

## Acceptance criteria

- [x] `worktrail query --status blocked` returns tasks — checked on the real
      tree, returned 5 blockers.
- [x] Unknown command: exit 2 + list of available ones, ZERO references to
      `127.0.0.1`.
- [x] `worktrail serve --frobnicate` exits 2 and does not start the server
      (test with a timeout, so a regression does not hang the suite for 127
      s).
- [x] Subcommand exit code propagated (a typo in a `query` flag still fails).
- [x] `worktrail --help` lists EVERY command from the table — generated from
      it, not a manual list.
- [x] `worktrail check` checks real tasks (1368), not zero.
- [x] `worktrail` with no arguments still starts the server (HTTP 200 on
      `/api/ping`).
- [x] 13 tests in `cli.test.mjs`; full backlog suite green.

## Notes

**Deliberately OUT of scope:**

- `worktrail init` (setting up a fresh backlog) and `worktrail stats` —
  require extracting the dashboard core; a separate task, once the repo
  extraction happens.
- Per-command `--help` built from the table's `usage` — today `--help` goes
  to the script, which has its own help (or none).
- Rewriting the scripts as libraries with a thin `main` — see "rejected
  alternatives".

**Bug class worth remembering:** a parser that ignores unknown input turns a
typo into silently running something else. Input validation is cheaper than
explaining why the tool "does nothing".

## Log

- 2026-08-29 created — claude — founder's report: "every command opens the
  page"
- 2026-08-29 done — claude — dispatcher + server flag validation + `check`
  without false green
