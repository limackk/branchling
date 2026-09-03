---
id: TL-205
title: "The decision panel is a wall of equal-weight boxes"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P0
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: [TL-204]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: panel
    bash: "node --test scripts/tests/decision-panel.test.mjs"
  - id: rendered
    manual: "Open `Waiting on you` on a backlog with at least one question carrying options and three tasks marked for a person: the questions are distinguishable from the marked tasks at a glance, the recommended option is visibly the recommended one, and nothing repeats a phrase that carries no information for that row"
---

## Goal

`Waiting on you` can be read. Today every row is the same box in the same
weight, whether it carries a paragraph somebody has to think about or nothing
at all beyond a mark.

## Context

Reported on 2026-09-03 from the panel on this backlog, with 203 tasks and
eleven rows waiting.

**Two different things are rendered identically.** A row is either a task
marked `executor: human`, which has no text to read and needs one action, or a
question, which is a paragraph of argument. They arrive as the same card with
the same input box under it. The reader cannot tell, without reading, which
rows will cost them a minute and which a second.

**The question text is a wall.** It is one long line in a bordered box, in the
same weight as the chrome around it. The two real examples in this repository
run to three and five lines of dense prose with no structure — because the
asker had nowhere to put structure. TL-204 gives them somewhere: options, one
of them recommended. This task renders that, which is why it comes second.

**Repetition that carries nothing.** `releases nothing else` appears on every
row that releases nothing else — which is most of them — in the same position
and weight as `releases 1 task`, the only value that changes a decision.
`What was decided, and why` is the placeholder on every input.

**What the panel gets RIGHT and must keep.** The order: rows are sorted by how
many tasks the decision would release, counted transitively through `blocks`,
because a task that unblocks one that unblocks nine is not a small decision.
That is the panel's unit of priority and it must survive any redesign — sorting
by age would put the oldest question above the one holding the release.

**The constraint that shapes the work.** `scripts/decision-panel.mjs` is pasted
into the page BY SOURCE so `node --test` and the browser run the same code, and
it may import nothing but `task-fields.mjs`, which is pasted before it. A
redesign that needs a new import has to move that module earlier in the paste
order, deliberately, not by accident.

## Pre-flight reading

1. `scripts/decision-panel.mjs` — the whole module, including the header on why
   it is a module and what the paste order forbids.
2. `scripts/build-viewer.mjs:5776` onwards — the rendering, and `:1756` for the
   panel's styles.
3. `backlog/tasks/TL-204-*.md` — the option shape this has to render.
4. `backlog/tasks/TL-115-*.md` — what the panel was for.

## Steps

1. Separate the two kinds visibly: a marked task and an open question are not
   the same object and must not look alike.
2. Render options as choices, with the recommended one marked and its reason
   readable without opening anything.
3. Drop every phrase that is constant across rows; keep `releases N` only where
   N changes the ordering.
4. Give the question room: it is the only text on the page somebody has to
   think about.
5. Extend `scripts/tests/decision-panel.test.mjs` for the computed parts, and
   verify the rendered result by looking at it — a panel is judged by reading.

## Decisions

Nothing decided. `blocked_by: [TL-204]` on purpose: the panel should be
designed once, against the final shape of a question, rather than twice.
