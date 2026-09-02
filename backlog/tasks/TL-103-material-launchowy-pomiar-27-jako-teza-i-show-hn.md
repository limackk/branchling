---
id: TL-103
title: "Launch material — the 27% measurement as thesis, and Show HN"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open source publication"
priority: P1
status: pending
owner: unassigned
estimate: 4h
confidence: low
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-102]
blocks: []
related_docs:
  - docs/funkcjonalnosci.md
verification:
  - bash: "test -f docs/launch/post.md && grep -qi 'verification' docs/launch/post.md"
  - manual: "The post can be read in 3 minutes, opens with a measurement from our own backlog (with a command to repeat it), not a description of features; the Show HN title and first sentence name the problem, not the tool"
---

## Goal

Ready launch material: a post (for the repo and for a blog/HN) with a
measurement from our own backlog as the thesis, a Show HN title, and a
publication plan. A project in this category grows from one good launch, not
from SEO — this task turns that launch into a prepared artifact instead of
an improvisation on publication day.

## Context

We have a story competitors do not, because it takes the nerve to measure
yourself: **12 out of 44 closed tasks in our own backlog had a combined 60
unchecked acceptance criteria — with a working `verification:`** (measurement
2026-08-31, methodology and command in `## Context` of TL-86). The post's
conclusion: a checkbox ticked by the executor carries no information when
the executor is an agent; that is why here "done" is a process exit code,
and the tool checks criteria off from evidence.

Post frame: **problem → measurement → mechanism → demo**. NOT "we present a
task management tool" (category taken, the reader closes the tab), but "the
agent says done and that is not true — we measured how often, and built a
gate". The tool appears as a consequence of the thesis, in the second half.

`confidence: low`, because the measurement has to be REPEATED before
publication: the numbers from 2026-08-31 will be stale on launch day, and a
post with a command for the reader to repeat it cannot state a result that
command no longer produces. If a fresh measurement after TL-86 is
implemented gives a different number — the post uses the fresh one and talks
about improvement, which is an even better story.

Overriding principle: **every number in the post has, next to it, the
command the reader will use to repeat the measurement on their own
backlog.** This is what separates a measurement from marketing, and it is
consistent with the whole character of the tool.

## Pre-flight reading

1. `backlog/tasks/TL-86-*.md`, `## Context` section — the source
   measurement and its methodology; the post must not claim more than the
   measurement showed.
2. `docs/funkcjonalnosci.md` §4 — what will deliberately not exist; the post
   does not promise anything from this list.
3. `backlog/tasks/TL-81-*.md` — the settled package name and channels; the
   post must give a working install command.

## Steps

1. Repeat the measurement on the current tree; save the measurement script
   in `docs/launch/`.
2. Write `docs/launch/post.md` in the problem → measurement → mechanism →
   demo frame, in English, ≤3 minutes to read.
3. Show HN title + 2-3 variants; the author's first comment (context,
   limitations, what the tool does NOT do — honesty plays better on HN than
   enthusiasm).
4. Publication plan: order (repo → post → HN), day of the week, who answers
   comments in the first hours.
5. Go through the post's list of claims and check each one against the
   current version of the tool.

## Acceptance criteria

- [ ] The post opens with a measurement, not a description of the tool; every number has the command to repeat it next to it.
- [ ] The measurement is repeated on the tree from publication day, with a script saved in the repo.
- [ ] The title and first sentence name the problem, not the product category.
- [ ] The install command in the post works (depends on the decisions in TL-81).
- [ ] A prepared first author comment with the tool's limitations exists.

## Log

2026-09-01 pending — agent:claude — created from a competitive analysis: a launch is an artifact to prepare, not an event; the post's thesis is the 27% measurement from TL-86, to be repeated before publication.
