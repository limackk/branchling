---
id: TL-142
title: "A task created in hosted mode is visible before its file exists"
type: task
labels: []
board: main
epic: ""
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 1d                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: ["TL-145"]
related_docs: ["docs/branchling-state-and-sync.md"]
verification:                      # HOW to check that the task is really done
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: sections-read
    manual: "Sections 4, 4.4, 6, 2.1 and 9 of docs/branchling-state-and-sync.md were read end to end in ONE pass, and give a single answer to where content lives in each mode: 4 scoped to local and pointing onward, 4.4 stating why hosted is forced, 6 stating the server-first rule for `new` and the offline rule, 2.1 and 9 carrying the limit that creation was excluded from the measurement"
---

## Goal

Define what `worktrail new` writes to, and what the rest of a team sees, in the
hosted mode — and make the two places in `docs/branchling-state-and-sync.md`
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

`docs/branchling-state-and-sync.md` §6.2 records the current boundary
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
4. Record the outcome in `docs/branchling-state-and-sync.md` §6, which today
   states the opposite boundary.

Deliberately NOT here: extending `scripts/branch-scan.mjs` so `query` reports a
task that exists only on an unmerged branch. That is code against the rule this
task writes, it is worth doing for the local mode alone, and it has its own
positive control to earn — TL-145, which `blocks:` records. Keeping it here
would have given one task two deliverables and one verification covering
neither.

## Acceptance criteria

- [x] §4's headline scopes itself to the LOCAL mode and sends the reader on. [proof: sections-read]
- [x] §4.4 states why hosted mode is FORCED to move content, and what that costs. [proof: sections-read]
- [x] §4.4 separates that from what §4.2 rejected, so the two are not read as one. [proof: sections-read]
- [x] §6 states the server-first rule for `new`. [proof: sections-read]
- [x] The offline remainder is SHOWN by naming the branch, not resolved. [proof: sections-read]
- [x] The orphan rule is written: retraction is a new event, never an edit to the log. [proof: sections-read]
- [x] §2.1 and §9 both carry the limit that creation was excluded from the measurement. [proof: sections-read]
- [x] The backlog guards pass with this change in the set. [proof: guards-green]
