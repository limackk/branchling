---
id: TL-210
title: "An Execution card ignores work running in another worktree"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: elsewhere-runs
    bash: "node --test scripts/tests/viewer-plan.test.mjs"
---

## Goal

A task the branch scan reports as running in another worktree renders as
RUNNING on the Execution view — with the same `is-running` border and the same
elapsed bar a local task gets — and names the tree it is running in.

## Context

Asked on 2026-09-03 while an unattended run was working in a worktree and the
Execution view, served from the main checkout, showed its wave standing still.

The data is already there and already correct. From the main checkout, with
the work happening on a branch:

    TL-205 … status: pending,
      elsewhere: [/…/worktrees/autonomous-flow-tasks-35273f: in_progress]

The Tasks view renders that — `.task-card.elsewhere` and `.badge-elsewhere`
exist (TL-124) and name the tree. The Execution view does not:
`renderCard()` in `scripts/viewer-plan.mjs:368` derives every class from the
LOCAL status, and the card it is handed carries no `elsewhere` field at all.

    if (card.inProgress) cls.push("is-running");

**The expensive half is already built.** Ten lines below, a running card gets
`exec-bar` — elapsed against estimate, with a label. Feeding `elsewhere` into
`inProgress` makes a wave move while somebody watches it, which is the whole
of what was asked for, without switching the page's subject to anything.

**It is not TL-188 and it is much cheaper.** TL-188 makes another worktree the
SUBJECT of the view — a control, URL state, read-only write paths. This one
changes what a card knows about itself, and the page keeps showing this tree's
plan. Whoever does TL-188 later inherits this; the reverse is not true, so
this one goes first.

**Two things must not be lost.** A card that is running ELSEWHERE is not the
same as one running here — the reader must be able to tell, because they can
act on one and not the other, so the tree's name belongs on the card as it
does in the Tasks view. And the elapsed bar's meaning has to survive: it
measures from the take recorded in history, which the scan reports for the
other tree too, so a bar drawn for a foreign card must come from that tree's
record and not be invented locally.

**Push is still missing and is separate.** Without TL-122 the page shows the
foreign state as of its last render. That is a real limit and the card must
not pretend otherwise; it is also not a reason to wait, since a reload already
answers correctly today.

## Pre-flight reading

1. `scripts/viewer-plan.mjs:330-410` — `renderCard()` and the function that
   builds the card model above it; the `elsewhere` field has to enter there.
2. `scripts/elsewhere.mjs` and `scripts/build-viewer.mjs:247` — how the Tasks
   view already turns a scan result into a badge, so the two views describe the
   same fact with the same words.
3. `scripts/branch-scan.mjs` — `crossBranchState()` and `divergences()`: what
   the scan knows per worktree, and what it deliberately does not.
4. `backlog/tasks/TL-188-*.md` — the switcher this precedes.

## Steps

1. Carry `elsewhere` into the Execution card model.
2. Treat a foreign `in_progress` as running for the class and the bar, and name
   the tree on the card.
3. Distinguish foreign from local visibly — a reader must not act on one
   thinking it is the other.
4. Extend `scripts/tests/viewer-plan.test.mjs` over a fixture whose scan
   reports a foreign in-progress task, asserting both the class and the name.

## Decisions

**The bar is drawn, and the scan was made able to answer for it.** The open
question was whether a foreign card gets an elapsed bar at all. Drawing one
from THIS tree's history would have measured the last time WE held the task —
a duration nobody has been working, drawn as if somebody were. So the scan now
reports `since` on a worktree observation: the timestamp of the last entry in
THAT tree's `history/<ID>.jsonl` which set the status it is reporting
(`statusSetAt()` in `branch-scan.mjs`). The bar comes from that record or it is
not drawn.

**`since` is worktrees only.** A branch's log would have to be read as a blob
per ref, and a branch nobody has checked out has nobody standing in it — the
state is committed, not being worked on this minute. A branch observation
therefore carries no start, and the card degrades to the running state and the
branch's name with no bar. That is the honest half, not a gap to fill later.

**No status name entered the code.** `statusSetAt()` is asked about the status
the other tree is CURRENTLY reporting, whatever a project calls it;
`runningElsewhere()` in `elsewhere.mjs` takes `in_progress_status` from the
caller. `elsewhereCardAttrs()` beside it still refuses to name a status,
because it answers a different question — "something disagrees" is true of any
difference, "somebody is working on it" is a claim about one value.

**`inProgress` kept its local meaning; `running` is the new one.** The card has
to be able to make both claims: `inProgress` is this tree's status, `running`
is work in flight anywhere, and only the second drives the border and the bar.
Collapsing them would have left no way to ask which of the two a card is.

**Two marks, neither a hue alone.** `is-elsewhere` turns the running border
dashed — the same mark the Tasks view puts on a card seen differently (TL-124)
— and the head carries `running in <tree>` in words, with the full path in the
title. A reader must not act on a foreign card thinking it is local, and a
colour is not a signal on a printout.

**`viewer-plan.mjs` may now import from `elsewhere.mjs`.** Its header said NO
IMPORTS; the real constraint is the paste order in `build-viewer.mjs`, which is
the module graph written by hand, and `elsewhere.mjs` is pasted first
(`plan.mjs` already relies on the same arrangement for `task-fields.mjs`). The
header now says that rather than a rule the file was about to break.

**Still not done here:** push (TL-122), so the page shows the foreign state as
of its last render; and the worktree switcher (TL-188), which makes another
tree the SUBJECT of the view rather than a fact on a card.
