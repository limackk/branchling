---
id: TL-482
title: "Agent estimate is a computed field on every task read"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-10-21
updated: 2026-10-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: fixtures
    bash: "node --test scripts/tests/agent-time.test.mjs"
  - id: not-stored
    bash: "! grep -l '^agent_estimate:' backlog/tasks/*.md backlog/_template.md _template.md"
  - id: envelope
    bash: "node --test scripts/tests/json-envelope.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Every task carries a COMPUTED field `agent_estimate` — the agent-time bucket of its `estimate` (p20, median, p80, n and the report's verdict), or `null` when that bucket has not met `agent_time_min_n` — wherever a task is read as data: `query --json` rows, the `task` object `next --json` hands over, and the viewer, where it shows as a badge on the card and a field in the detail panel. It is never written into a task file.

## Context

TL-480 delivered agent time as a report (`stats --agent-time`) and as a printed sentence in `new` and `next`. The owner asked on 2026-10-21 for it to be a FIELD rather than a sentence, and visible in the viewer. Two shapes were offered: a field written into the frontmatter and refreshed by a command, or a field computed on every read. The owner chose the computed one. The stored shape stays rejected for the reason TL-480 recorded: a computed value stored by hand goes stale with every closed task and turns each refresh into a diff across the whole tree (law 2).

The value is per ESTIMATE, not per task: two open tasks estimated `4h` carry the same `agent_estimate`. That is what the ledger can honestly say about a task nobody has worked yet. Because the verdict on this tree is `uncorrelated`, the field carries the verdict beside the range, so a reader of a single task is told what the report says above its table.

`next --json` currently carries the same bucket as a top-level `agentTime` key (TL-480). Moving it onto the task is the point of this change, so the top-level key goes and `docs/manual.md` follows.

## Steps

1. Add a pure function to `scripts/agent-time.mjs` that turns a report and an estimate into the field value — `{ p20, median, p80, n, label, verdict }` in minutes, or `null` — and attach it to task rows in `query --json` through `scripts/agent-time-read.mjs`, without a second read of the tree.
2. In `next`, put the field on the handed-over `task` object in JSON, drop the top-level `agentTime` key, and render it in the text output as a field line (`agent_estimate: …`) rather than a sentence; render `new --estimate` the same way.
3. In `scripts/build-viewer.mjs`, compute the report once at build time from the history the page already receives, attach the field to each task, show a badge beside the `~estimate` badge on the card, and a labelled field in the detail panel that names the verdict when it is not `correlated`. Tokens for any new surface in both the light and dark blocks.
4. Update `docs/manual.md` (task-list row, task-take row) and the JSON envelope declaration.
5. Tests on fixtures: the field is null below the threshold and present above it in `query --json`; `next --json` carries it on `task`; the built viewer contains the field for a task whose bucket qualifies.

## Acceptance criteria

- [x] The field is computed from the ledger, null below the threshold, and reaches query, next and the viewer on a fixture backlog. [proof: fixtures]
- [x] No task file and no template carries the field; it exists only when read. [proof: not-stored]
- [x] The envelope declaration and the manual agree on the moved key. [proof: envelope]
- [x] The whole suite stays green. [proof: suite-green]
