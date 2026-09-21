---
id: TL-107
title: "Execution plan: plan.yaml, parser and consistency guard"
type: task
labels: []
board: main
epic: "Execution plan"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 1d
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: [TL-108, TL-109]
related_docs: []
verification:                      # HOW to check that the task is really done
  - bash: "node --test scripts/tests/plan.test.mjs"
  - bash: "node scripts/cli.mjs check --plan"
---

## Goal

The implementation order of the backlog is to be DATA in the repository: one
file, `backlog/plan.yaml`, describing execution waves, "do together" groups
and the reasoning behind the order. After this task there is a parser for this
file and a guard, `worktrail check --plan`, that fails when the plan lies
against the `blocked_by` graph.

When the task is done, it is true that:
- the `plan.yaml` format is defined and parsed by a single module
  (`scripts/plan.mjs`), used by every consumer — with no second parser in the
  viewer or the guard (the same principle as `parseBoardsYaml` in
  `scripts/config.mjs`),
- an inconsistent plan fails the build, instead of quietly showing the wrong
  order.

## Context

The backlog has ~70 tasks. We want an agent to settle the implementation
order (which tasks to do first, which together), with the viewer showing plan
execution live. The 2026-09-01 analysis (Claude session) settled the key
decisions:

- **Order is NOT a board.** A board is a "who/context" partition (a closed
  vocabulary in `boards.yaml`); execution order is a different axis. Rejected.
- **Order is NOT a frontmatter field** (`sequence:`). Reshuffling the plan
  would change 70 files at once — an unreadable diff, conflicting with every
  branch. Rejected.
- **Order is a separate file, `backlog/plan.yaml`.** The agent's decisions
  (the order among free tasks, "together" groups, the reasoning) are NOT
  computable from the tree — this is data in the sense of law 1 in
  CLAUDE.md, so it travels in the repo and through review. Only its
  VALIDATION is computable.
- **The plan is advisory, status is the truth.** The plan does not hard-block
  anything; the only hard condition is agreement with `blocked_by` (a task
  cannot sit in a wave earlier than its blocker). Otherwise the plan would
  become a second source of truth about state.
- The plan itself is LAID OUT by the agent (by hand / in a session) — the tool
  only validates it. Automatically laying out the plan is deliberately NOT
  the scope of this task.

Proposed format (to be refined during implementation, keys in English — this
is the tool's surface, values are project data):

```yaml
updated: 2026-09-01
rationale: "one sentence: why this order"
waves:
  - name: "Foundation"
    tasks: [TL-27, TL-28]
  - name: "Consumers"
    tasks: [TL-29, TL-30]
    together: [[TL-29, TL-30]]   # shared branch / shared files
```

Guard rules (`worktrail check --plan`, also included in the aggregate
`worktrail check`):

1. Every ID in the plan exists in the tree (like `check-backlog-refs`).
2. A task in wave N does not have, in `blocked_by`, a task from a wave > N
   nor a task outside the plan that is open. A blocker in the same wave =
   warning (it may be a sequence within the wave), in a later wave = error.
3. IDs in `together` belong to the same wave.
4. A duplicate ID in the plan = error.
5. A closed task (`done`/`cancelled`) in the plan is NOT an error — a
   historical plan has a right to exist; the view is what computes the
   "active wave".
6. A MISSING `plan.yaml` is not an error — the feature is optional; the guard
   then says "no plan file" and passes. But the guard MUST have a positive
   control in the tests (a fixture with a broken plan that fails) — a guard
   that is green on a zero sample proves nothing (rule from CLAUDE.md).

Whether `plan.yaml` is versioned: YES (it is data, not a view) — do not add it
to the gitignore of generated views.

## Pre-flight reading

1. `CLAUDE.md` — the four laws; especially 1 (data in the repo) and 2
   (computed things may be deleted) — the plan is on the DATA side.
2. `scripts/config.mjs` — `parseBoardsYaml` as the pattern: one parser for a
   limited YAML shape, zero npm dependencies.
3. `scripts/check-backlog-refs.mjs` — the pattern for a guard on dangling IDs
   and how it reports errors.
4. `scripts/cli.mjs` — how `check` aggregates guards and how a flag is added.
5. `scripts/tests/dangling-refs.test.mjs` and `scripts/tests/_repo.mjs` — the
   pattern for a guard test on a fixture (the backlog directory ALWAYS from
   `_repo.mjs`).

## Steps

1. Define and implement the `plan.yaml` parser in `scripts/plan.mjs` (shape as
   above; an unknown key fails — consistent with the rest of the configs).
2. Implement validation (rules 1–6 from Context) in the same module, returning
   a list of issues with error/warning levels.
3. Wire `worktrail check --plan` into `scripts/cli.mjs` and include it in the
   aggregate `worktrail check`; messages in English, in the style of the other
   guards.
4. Tests: a valid plan passes; every error type fails with a readable message;
   a missing file = pass with an annotation; a positive control is present.
5. Create a starter `backlog/plan.yaml` for this epic (waves: TL-107 →
   TL-108/TL-109 → TL-110) — the plan tracks its own implementation.
6. Update `README.md` (the section on backlog files) with `plan.yaml`.

## Acceptance criteria

- [ ] `node --test scripts/tests/plan.test.mjs` green, with a positive control
      (a broken plan fails).
- [ ] `worktrail check --plan` exists, is in `--help` and in the aggregate
      `check`.
- [ ] A plan with a task placed before its `blocked_by` fails the build with
      a message naming both IDs and both waves.
- [ ] A missing `plan.yaml` fails nothing.
- [ ] `backlog/plan.yaml` exists, describing this epic's waves, and passes its
      own guard.
- [ ] The entire new surface (code, messages, tests) is in English;
      `worktrail check --language` is green.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

2026-09-01 pending — agent:claude — task created from the "execution plan with
viewer monitoring" analysis; design decisions in Context.
