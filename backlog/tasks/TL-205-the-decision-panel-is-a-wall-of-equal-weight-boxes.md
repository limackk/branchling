---
id: TL-205
title: "The decision panel is a wall of equal-weight boxes"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P0
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
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

**The two kinds differ in SHAPE, not in a badge.** A question is an elevated
card with a left accent rule and 14px of air around it; a task marked for a
person is a flat line on the page background with 2px, no border and no card.
The `question` / `for a person` badges are gone with them: a badge saying what
the form already says is the same repetition this task was filed about, one
level up. What the reader has to be told once — that a card is a question and a
line is a marked task — is in the lede, where it is said once instead of eleven
times.

**One list, and the order is untouched.** Grouping the questions above the
tasks was the obvious way to separate them and it was rejected: the panel's unit
of priority is how many tasks a decision releases, counted through the chain,
so a section break would put a question that frees nothing above a task that
frees nine. The two kinds interleave, and the difference in vertical rhythm
does the separating.

**`releases nothing else` is not shortened, it is removed.** It stood in the
position and the weight of `releases 1 task` — the one number on the row that
changes the ordering — on most of the rows, so the column read as noise and the
rows that mattered did not stand out. Absent now means nothing is released. The
counts that remain line up in one right-hand column across BOTH kinds of row,
because a sort key that cannot be scanned down is not doing its job; a flat row
gets an empty spacer element to push with, since two `margin-left: auto`
siblings split the free space and strand the count in the middle.

**`marked executor: human` went the same way, and the ROLE case did not.** The
phrase was on nearly every task row, and the flat shape plus the lede now carry
it. The other reason a task lands here — a role this deployment has no agent
for — is NOT what the shape implies, so it is still spelled out. Constant to the
form, variable to the text. The owner was dropped from the row entirely rather
than compared against the literal `unassigned`: that word is a value in
`config.yaml`, not something the code may know, and who holds a task is one
click away on the task itself.

**Three prompts where there was one.** `What was decided, and why` on every
input in the panel is what made a wall of them. A question with a menu now
prompts `An answer that is not on the menu`, a question without one prompts
`Your answer, and why` under an `Answer` button, and a marked task keeps the
old wording behind a collapsed `note a decision` disclosure — its row's real
action is to go and do the task. `<details>` and not a scripted toggle: it
opens over `file://` with none of the page's JavaScript running.

**The menu is rendered here, so TL-207 has nothing left.** TL-207 was carved
out of TL-204 as "the panel does not show a question's options"; its three
rendering steps are step 2 of this task, and doing them first would have meant
designing the row twice — the thing `blocked_by: [TL-204]` was set to avoid.
`options` and `recommend` are carried onto the row by `decisionPanel()`,
normalised to an array and a number-or-null so no caller has to distinguish the
three states on disk, and NOTHING is invented: a question asked without options
draws no list.

**Picking a row sends the NUMBER, and `/api/decision` learned `choose`.** The
alternative — the page posting the option text it had rendered — was rejected:
it would be a second opinion about what option 2 says, and the wrong one after
a log is edited by hand. The number resolves against the event the question was
asked in, inside `decideTask`, which is the same function `decide --choose <n>`
calls, so `chose: <n>` lands beside the answer and a later review can still ask
how often the recommendation was followed. The server validates the number's
SHAPE and refuses `choose` without `resolves` — one task can carry two open
questions, and row 2 of the wrong one records a real answer to a question
nobody asked.

**The recommendation's word is `--fg`, not `--accent`.** The tag sits on
`--accent-soft`, where the accent reaches about 2.3:1 in the light theme and is
unreadable at 10px. The row's fill and border already carry the colour; the
word is the half that has to survive a monochrome print, so it takes the
readable value.

**Surfaced and filed, not fixed here:** TL-208 (the snapshot banner says `Tryb
snapshot`, and `check --language` walked past it) and TL-209 (`/api/decision`
normalises an unparseable actor to `unknown` and returns 200, so its
"no valid namespace" branch can never be taken).
