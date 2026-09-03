---
id: TL-197
title: "backlog/activity/ is computed data that no .gitignore line keeps out of a commit"
type: task
labels: [hygiene]
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m
confidence: high
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - .gitignore
verification:
  - bash: "git check-ignore -q backlog/activity && echo 'backlog/activity ignored — OK' || { echo 'still committable'; exit 1; }"
  - bash: "test -z \"$(git status --porcelain -uall | grep 'backlog/activity')\" && echo 'no activity file offered to a commit — OK'"
---

## Goal

`backlog/activity/` must not be committable, for the same reason `INDEX.yaml`
is not.

## Context

Found on 2026-09-03, auditing the tree before the first push.

`git status -uall` offers 31 untracked files under `backlog/activity/rollup/`
(124 kB). Their content is an aggregate — minutes, session count, first and
last timestamp per task:

```json
{ "minutes": 13.1, "sessions": 1, "first": "...", "last": "...", "unknown_ratio": 0 }
```

That is COMPUTED data, which law 2 says may be deleted, and every other
computed artefact in this repository is named in `.gitignore`: `INDEX.yaml`,
`NOW.yaml`, `archive/done.yaml`, the boards, `viewer.html`,
`history/.snapshot.json`. `backlog/activity/` is the one that is not, so it
survives on nothing but the author of the next `git add -A` noticing.

Two costs if it is committed, and they are the same ones the existing
`.gitignore` comment already spells out for the views: every branch rewrites
the same rollup files, so two branches conflict even when they share no task;
and a committed rollup reads exactly like a fact while showing the state of
whichever machine last ran the hook.

There is a third, smaller: the rollups are a per-task timesheet of the owner's
working hours. Harmless here, and not the reason for this task, but it is not
something to publish by accident either.

`backlog/history/*.jsonl` is DELIBERATELY not in this category — it is
append-only truth, tracked on purpose, and a guard already fails when it is
untracked (TL-43).

## Pre-flight reading

1. `.gitignore` — the comment above the views says the reasoning; this entry
   belongs under the same one.
2. `scripts/activity-hook.sh` — what writes these files, and whether anything
   reads them back across machines.

## Steps

1. Confirm that nothing reads `backlog/activity/` expecting it to be shared —
   if something does, this task is wrong and says so instead.
2. Add `backlog/activity/` to `.gitignore`, under the existing comment about
   generated views.
3. Check the same question for `.claude/settings.local.json`, which is also
   unignored today and is by convention a machine-local file.

## Acceptance criteria

- [ ] `git check-ignore backlog/activity` succeeds.
- [ ] `git status -uall` offers no file from that directory.
- [ ] A decision recorded about `.claude/settings.local.json`, either way.
