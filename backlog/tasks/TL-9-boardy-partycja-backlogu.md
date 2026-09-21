---
id: TL-9
title: "Boards — partitioning the backlog into main and backlog-project"
type: task
labels: [post-launch]
board: main
epic: ""
priority: P2
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs:
  - backlog/boards.yaml
verification:
  - bash: "node --test backlog/scripts/tests/boards.test.mjs"
  - bash: "node backlog/scripts/build-backlog.mjs && ls backlog/boards/main/NOW.yaml backlog/boards/backlog-project/NOW.yaml"
---

## Goal

Split the backlog into boards, so that work on the tool itself does not mix
with work on the product. Two boards to start: `main` (everything that
delivers the origin project) and `backlog-project` (improvements to the `backlog/`
module). The user picks the board; when they don't supply one, the agent
should get an answer from a deterministic script, not from its own
judgment.

## Context

`epic` does not fit this layer: it is free text (144 unique values,
spelling variants like `Daily planner` / `Daily Planner`), and README §3.1
says outright "it is not a hierarchy". Nothing fails on a typo in the epic,
and that is fine — the epic only groups. The board is the opposite: it is
sometimes selected by a machine, so a typo would create a third board that
nobody opens, and the task would vanish from both views that are actually
read. Hence the asymmetry: the board dictionary is closed (`boards.yaml`),
an unknown slug fails the build.

Rejected alternatives:
- **A prefix per board** (`DEV-12`, `ANA-3`) — would break
  `next-backlog-id.mjs` (a union computed with `/^BL-(\d+)-/` across
  worktrees and branches), the ID-collision guard, and every `BL-NNN`
  reference in docs and commits.
- **Directories `tasks/<board>/`** — would break `readdirSync(TASKS_DIR)` in
  three scripts, `fileForTaskId()` in `serve-backlog.mjs`, and every
  `tasks/BL-...` path recorded in the INDEX. Board as a frontmatter field =
  zero file movement.
- **Multiple boards per task** — that is no longer a partition, just a
  second set of `labels`.

A non-obvious discovery from routing (measured across the whole tree,
2026-08-29): a router keyed on the WORD "backlog" would assign 247 of 1339
tasks to the tool's board, because the agent protocol (README §5) requires
calling `build-backlog.mjs` in every task. A router keyed on PATHS with no
exception list gave 17 hits, 9 of them false — for the same reason
(`backlog/scripts/build-backlog.mjs` and a link to `backlog/README.md`
appear in product tasks too). That is why `boards.yaml` has `ignore_paths:`
with the protocol paths. After subtracting them, 9 hits remained, 8 of them
genuine tasks about the backlog's viewer/dashboard.

One manual override of the router: **BL-904** ("Pre-commit guards do not
run on a clean merge") — the router proposed `backlog-project`, because the
task mentions `backlog/scripts/tests/backlog-id-collisions.test.mjs`. The
work in this task modifies `.githooks/*`, and the backlog test is there
only as a regression net → `main`.

## Steps

1. `backlog/boards.yaml` — the registry (slug, name, description, routing
   `paths:`, global `ignore_paths:`, `default: main`).
2. `build-backlog.mjs` — reading the registry, the `board` frontmatter
   field, `by_board` in the statistics, `board:` in FOCUS/INDEX/archive
   rows, views at `boards/<slug>/{FOCUS,INDEX}.yaml`, a `--root` flag
   (testability), a hard exit 1 on an unknown slug.
3. `suggest-board.mjs` — a router by path from `related_docs:` and from the
   task's content, minus `ignore_paths`.
4. `_template.md` — the `board:` field above `epic:`.
5. Migrate 1339 files: `board:` inserted after `epic:`; 8 viewer/dashboard
   tasks → `backlog-project`, the rest → `main`.
6. Documentation: README §3.5 + agent protocol §5, workspace `CLAUDE.md`
   § Backlog.

## Acceptance criteria

- [x] Every one of the 1339 tasks has a `board:` from the `boards.yaml`
      dictionary.
- [x] `boards/main/` and `boards/backlog-project/` have their own views
      (today: NOW.yaml + INDEX.yaml; at the time this task was created it
      was FOCUS.yaml — retired in TL-13).
- [x] The root `NOW.yaml` / `INDEX.yaml` remain global (nothing that reads
      them needs to change).
- [x] An unknown slug fails the build (exit 1), a missing field = default +
      warning.
- [x] `node --test backlog/scripts/tests/boards.test.mjs` — 6/6 green.

## Verification

```bash
# Module test — 6 cases, including "the real tree has valid boards"
node --test backlog/scripts/tests/boards.test.mjs

# Per-board views are created and sum to the whole
node backlog/scripts/build-backlog.mjs

# Router: a task about the module vs a product task
node backlog/scripts/suggest-board.mjs backlog/tasks/TL-1-dashboard-w-backlog-viewerze.md  # → backlog-project
```

## Notes

Deliberately out of scope (separate tasks, when needed):
- the viewer/dashboard does not yet know about boards — the board should be
  a SCOPE there (narrowing the dashboard's numbers too), not another
  dropdown next to Epic, otherwise the metrics mix boards;
- no pre-commit guard for the `board` field — today only the module's test
  covers this, not a hook;
- `serve-backlog.mjs` has no `POST /api/board` (moving a task from the UI).

## Log

- 2026-08-29 created — claude — task created during rollout, as the first
  resident of the `backlog-project` board
- 2026-08-29 done — claude — registry + generator + router + migration of
  1339 tasks; red-first test (6 cases) green
