---
id: TL-579
title: "functionality.md stops contradicting the tool that ships"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: mcp-row-not-rejected
    bash: "! grep -qE '^\\| \\*\\*An MCP server\\*\\* \\| A second surface' docs/functionality.md"
  - id: no-registry-promise
    bash: "! grep -q 'TL-36\\*\\* — a cross-project view' docs/functionality.md"
  - id: docs-links
    bash: "node scripts/cli.mjs check --docs"
---

## Goal

`docs/functionality.md` no longer asserts anything the shipping tool contradicts: every claim it makes about what exists, what is coming and what will not happen is either true today or marked with the date it was true.

## Context

The document says it is the state "as of 2026-09-01" and has not followed the tool since. Found on 2026-11-05 while adding a row to its §4:

- §4 lists "An MCP server" as deliberately not happening, yet `branchling mcp` ships (TL-146, TL-435, TL-529 are done).
- The blockquote under the introduction says the root `README.md` is still another project's document and that TL-49 lists it; TL-49 is done.
- §3.6 "Time tracking" lists heartbeats, retention and cost adapters as coming, but TL-378 removed activity telemetry from the product (`docs/backlog-time-tracking.md`).
- §3.7 "Multiple projects" lists a project registry and a cross-project view as coming, while TL-380 made one repository the complete product boundary (`docs/branchling-global-tool.md`).

`docs-drift` does not flag this file, because it carries no `**Status:** PROJECT` line for the drift patterns to read; the gap is therefore invisible to the existing guard. Whether the document should be rewritten as current state, reduced to its §4 table, or retired in favour of `README.md` and `docs/manual.md` is part of this task's decision. A reversed rejection, such as the MCP server, should stay readable as a reversal with the task that reversed it, not disappear.

## Steps

1. Decide the document's role: current-state description, or a dated record of the 2026-09-01 scope plus the §4 table.
2. Correct or date every claim listed above, and any further one found while reading the whole file.
3. Keep the §4 row for sprints (2026-11-05) intact.
4. Run the documentation link guard.

## Acceptance criteria

- [x] §4 no longer states, unqualified, that an MCP server will not happen. [proof: mcp-row-not-rejected]
- [x] The document no longer lists a cross-project view as coming. [proof: no-registry-promise]
- [x] Every link in the documentation still resolves. [proof: docs-links]
