---
id: TL-292
title: "run has an explicit single-generalist mode"
type: task
labels: []
board: main
epic: "Provider-neutral agent execution"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-05
blocked_by: [TL-288, TL-289, TL-300]
blocks: [TL-293, TL-294, TL-301]
related_docs:
  - docs/manual.md
verification:
  - id: generalist-mode
    bash: "node --test scripts/tests/run-generalist-profile.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A user who wants one capable agent can name one profile and run the whole
eligible queue without learning role routing. The generalist path is the first
documented workflow and remains as rigorous about claims, verification and
failures as a specialist fleet.

## Context

Today a single raw `--agent` command serves all tasks when no `--agent-for` map
is present, including tasks with roles. Named profiles must preserve that useful
behavior instead of forcing every user to configure a fleet.

"Generalist" is an execution choice, not a new task role and not a built-in
agent persona. Do not add it to the project's vocabulary. The user chooses a
profile whose own prompt and model are broad enough for the queue.

## Pre-flight reading

1. `scripts/run-loop.mjs` — preserve the scalar-without-map routing rule.
2. `scripts/tests/run.test.mjs` — retain the positive control proving one command
   serves roleful and roleless tasks.
3. `docs/manual.md` — make the simple path precede specialist configuration.

## Steps

1. Add one explicit named-profile option for the generalist path.
2. Apply it to every task the current single-command mode would serve.
3. Define unambiguous behavior when generalist and per-role profiles are both
   supplied, matching the existing scalar/map semantics.
4. Keep `executor: human`, size gates, plan waves and task verification intact.

## Acceptance criteria

- [ ] One named profile can complete both roleless and roleful tasks with no
      role mapping. [proof: generalist-mode]
- [ ] Human-only and otherwise ineligible tasks remain untouched and counted.
      [proof: generalist-mode]
- [ ] Existing raw single-agent runs remain byte-for-byte compatible.
      [proof: suite-green]
