---
id: TL-142
title: "A task created in hosted mode is visible before its file exists"
type: task
labels: []
board: main
epic: ""
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 1d                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: ["docs/worktrail-state-and-sync.md"]
verification:                      # HOW to check that the task is really done
  - bash: "node --test scripts/tests/cross-branch-state.test.mjs"
---

## Goal

Define what `worktrail new` writes to, and what the rest of a team sees, in the
hosted mode — and make the two places in `docs/worktrail-state-and-sync.md`
that answer this agree with each other.

They do not agree today. The headline decision in §4 says **content in git**.
The mode table in §6 says that in hosted mode the SSOT for content is the
**server, and the repo is a replica**. Both are written as settled, and task
creation is where the difference is not academic: under §4 a task created on a
branch reaches the team only after push and merge; under §6 it reaches the
server first and every replica next, so the team reads the body immediately.

The §6 reading is the one that keeps the product usable for a team, because
the primary team flow is one person creating a task for ANOTHER person to pick
up — and that flow does not exist in the repository this design was measured
on. Note that §2.1 was measured with `--diff-filter=M`, so it deliberately
excluded creation, and it was measured on a single-person-plus-agents backlog.
"Content rarely changes" is a true statement about that population and says
nothing about hand-offs between people.

What has to be true when this is done:

1. `new` in hosted mode is defined as **server-first**: the task exists, with
   its body, for everyone before it exists on any branch. The branch file is a
   replica, as §6 already says.
2. The offline case is defined: `new` with no server reachable writes locally
   and reconciles on the next sync, with the server winning on content under
   the base-version check of §5.3. A `__created__` whose file never lands is
   therefore an OFFLINE artefact, not a normal one, and is shown as such.
3. §4's headline is narrowed to the local mode, so a reader no longer takes
   "content in git" as a claim about hosted mode.

## Context

`docs/worktrail-state-and-sync.md` §6.2 records the current boundary
deliberately: a task that exists only on another branch does NOT appear in the
list. That is defensible while git is the only transport, because the reader and
the writer are the same person on the same disk. In hosted mode the question
moves: the server holds the content, so the display rule for "exists on another
branch only" applies to the OFFLINE remainder, not to the ordinary case.

`scripts/branch-scan.mjs` is where the answer belongs — it already generalises
the branch scan from NUMBERS (`next-backlog-id.mjs`) to STATE, and existence is
the third question of the same shape. Do not add a second scanner: two copies
would diverge on "which branches exist", which is exactly the difference that
hands one task to two sessions.

Note the ordering constraint from §8: the server is built only once somebody
outside the founder uses the local mode. This task is the CHEAP half — the
decision and the display rule — which §7 argues is worth settling before foreign
data exists, because afterwards it is a migration of other people's history.

## Steps

1. Write the server-first rule for `new` into §6, and narrow §4's headline to
   the local mode.
1a. Decide how a creation that has NOT reached the server (offline, or local
   mode on another branch) is displayed. Starting position, by analogy with
   TL-73 decision 1: name the branch (`elsewhere: [feature/x: unmerged]`)
   rather than showing the task as if its file were here.
2. Decide what `query` and `stats` do with such a task — counted, listed,
   excluded — and make that consistent with how they already treat cross-branch
   state.
3. Decide the orphan rule: a `__created__` whose file never lands. Options
   include leaving it (a creation did happen), and a `__deleted__` written by
   whoever abandons the branch. Do NOT let the log be rewritten.
4. Extend `scripts/branch-scan.mjs` for existence, reusing the same branch
   enumeration.
5. Record the outcome in `docs/worktrail-state-and-sync.md` §6, which today
   states the opposite boundary.

## Acceptance criteria

- [ ] A task created on another branch and not merged is reported by `query`
      with its branch named, and is NOT reported as an ordinary task of this
      tree.
- [ ] The scan enumerates branches through `scripts/branch-scan.mjs` — a grep
      finds no second branch enumeration.
- [ ] Positive control: a test in which the task is present on NO other branch
      must show it absent, so the guard cannot pass on a zero sample.
- [ ] `docs/worktrail-state-and-sync.md` §4 and §6 no longer contradict each
      other on where content lives in hosted mode, and §6 states the
      server-first rule for `new` and the offline rule.
- [ ] §9 carries the measurement caveat: §2.1 excluded creation and was taken
      from a single-person backlog.
