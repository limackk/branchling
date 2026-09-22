---
id: TL-438
title: "The viewer throws on load: thirteen exposures name functions that no longer exist"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P0
status: in_progress  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-22
updated: 2026-09-22
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: every-exposure-is-defined
    bash: "node --test scripts/tests/viewer-script-syntax.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The served viewer renders. Today it serves 200, carries its data, parses
without a syntax error — and shows an empty shell, because the script throws a
`ReferenceError` on load and every statement after it, including the first
render, never runs.

## Context

Reported from the field on 2026-09-22: "the page is there, the inside is
empty". The server was not at fault — `GET /` answered 200 with 3.6 MB of HTML,
`/api/tasks` answered with the tasks, and `node --check` on the inline script
passed. The page was executed against a DOM and threw at the second line of
this block:

    window.selectTask = selectTask;
    window.changeTaskStatus = changeTaskStatus;   // ReferenceError here

Thirteen of the fourteen names that block assigned did not exist. They were the
viewer's WRITE surface — `startEdit`, `saveField`, `submitReason`, `saveChips`,
`openHistory`, `toggleHistory`, `toggleTaskGraph` and the rest — removed by
TL-379 together with the feature. The functions went; the exposures stayed.

**Why no test caught it.** `scripts/tests/viewer-script-syntax.test.mjs` was
written for exactly this family of defect and its header already drew the line
it did not cross: "Parses without executing — a page that only THROWS at
runtime is a different bug." Every other viewer test asserts on the page as a
STRING, which a page that throws satisfies as well as one that works. So the
viewer had been blank since TL-379 and the whole suite stayed green.

**Why the failure is total rather than partial.** These assignments sit at the
top level, not inside a handler. A missing name there is not a dead button — it
ends the script. Everything below it, including the call that draws the page,
is never reached.

## Steps

1. Remove the exposures whose functions no longer exist; keep the one that does.
2. Guard it: every `window.x = y;` in the generated page must name something the
   page defines. The check has to fail against the tree as it was.
3. State in the code why the block is dangerous, so the next removal of a
   feature takes its exposure with it.

## Acceptance criteria

- [ ] The generated page assigns no name it does not define, proven by a test
      that fails against the code as it was. [proof: every-exposure-is-defined]
- [ ] The guard cannot pass on a zero sample and has a positive control for a
      missing definition. [proof: every-exposure-is-defined]
- [ ] Nothing else in the suite changes. [proof: suite-green]
